package model

import (
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Department is an organizational unit used only for usage reporting. It has
// no effect on pricing, routing, or authorization. Departments form a tree of
// at most MaxDepartmentDepth levels; a top-level department has ParentId 0.
type Department struct {
	Id        int            `json:"id"`
	ParentId  int            `json:"parent_id" gorm:"index;default:0"`
	Name      string         `json:"name" gorm:"type:varchar(64);not null"`
	Sort      int            `json:"sort" gorm:"default:0"`
	Remark    string         `json:"remark" gorm:"type:varchar(255);default:''"`
	CreatedAt int64          `json:"created_at" gorm:"bigint"`
	UpdatedAt int64          `json:"updated_at" gorm:"bigint"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
	Deleted   bool           `json:"deleted,omitempty" gorm:"-"`
	Members   int64          `json:"members" gorm:"-"`
}

const departmentNameMaxLength = 64

// MaxDepartmentDepth is the deepest level a department can sit at.
const MaxDepartmentDepth = 3

// DepartmentUnassigned is the filter value that selects usage with no department.
const DepartmentUnassigned = -1

// DepartmentSnapshot is the department a user belonged to when usage was
// recorded, with its level-1 and level-2 ancestors at that time. A level is
// the department itself when the user sits at that level, and MidDepartmentId
// is 0 for a user directly in a level-1 department.
type DepartmentSnapshot struct {
	DepartmentId    int
	TopDepartmentId int
	MidDepartmentId int
}

// departmentChain lists a department and its ancestors from level 1 down,
// using parents (id to parent id). It returns nil for an unknown department
// and stops at MaxDepartmentDepth to stay safe on unexpected data.
func departmentChain(parents map[int]int, id int) []int {
	chain := make([]int, 0, MaxDepartmentDepth)
	for current := id; current != 0 && len(chain) < MaxDepartmentDepth+1; {
		parentId, ok := parents[current]
		if !ok {
			return nil
		}
		chain = append([]int{current}, chain...)
		current = parentId
	}
	return chain
}

func snapshotFromChain(chain []int) DepartmentSnapshot {
	if len(chain) == 0 {
		return DepartmentSnapshot{}
	}
	snapshot := DepartmentSnapshot{
		DepartmentId:    chain[len(chain)-1],
		TopDepartmentId: chain[0],
	}
	if len(chain) >= 2 {
		snapshot.MidDepartmentId = chain[1]
	}
	return snapshot
}

func departmentParents(tx *gorm.DB) (map[int]int, error) {
	var departments []struct {
		Id       int
		ParentId int
	}
	if err := tx.Model(&Department{}).Select("id, parent_id").Scan(&departments).Error; err != nil {
		return nil, err
	}
	parents := make(map[int]int, len(departments))
	for _, department := range departments {
		parents[department.Id] = department.ParentId
	}
	return parents, nil
}

// subtreeHeight is the number of levels in the subtree rooted at id.
func subtreeHeight(parents map[int]int, id int) int {
	height := 1
	for childId, parentId := range parents {
		if parentId == id && childId != id {
			height = max(height, 1+subtreeHeight(parents, childId))
		}
	}
	return height
}

// descendantDepartmentIds returns id and every department under it.
func descendantDepartmentIds(parents map[int]int, id int) []int {
	ids := []int{id}
	for childId, parentId := range parents {
		if parentId == id && childId != id {
			ids = append(ids, descendantDepartmentIds(parents, childId)...)
		}
	}
	return ids
}

// GetDepartments lists departments ordered for display. includeDeleted also
// returns soft-deleted departments so historical usage keeps a readable name.
func GetDepartments(includeDeleted bool) ([]*Department, error) {
	var departments []*Department
	query := DB.Model(&Department{})
	if includeDeleted {
		query = query.Unscoped()
	}
	if err := query.Order("parent_id asc, sort asc, id asc").Find(&departments).Error; err != nil {
		return nil, err
	}
	for _, department := range departments {
		department.Deleted = department.DeletedAt.Valid
	}
	return departments, nil
}

// GetDepartmentsWithMembers lists active departments with their current
// member counts (users directly in each department).
func GetDepartmentsWithMembers() ([]*Department, error) {
	departments, err := GetDepartments(false)
	if err != nil {
		return nil, err
	}
	var counts []struct {
		DepartmentId int
		Total        int64
	}
	if err := DB.Model(&User{}).
		Select("department_id, count(*) as total").
		Where("department_id <> 0").
		Group("department_id").
		Scan(&counts).Error; err != nil {
		return nil, err
	}
	countMap := make(map[int]int64, len(counts))
	for _, count := range counts {
		countMap[count.DepartmentId] = count.Total
	}
	for _, department := range departments {
		department.Members = countMap[department.Id]
	}
	return departments, nil
}

func GetDepartmentById(id int) (*Department, error) {
	var department Department
	if err := DB.First(&department, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, common.NewMessage("Department not found")
		}
		return nil, err
	}
	return &department, nil
}

func normalizeDepartmentInput(department *Department) error {
	department.Name = strings.TrimSpace(department.Name)
	department.Remark = strings.TrimSpace(department.Remark)
	if department.Name == "" {
		return common.NewMessage("Department name is required")
	}
	if len([]rune(department.Name)) > departmentNameMaxLength {
		return common.NewMessage("Department name is too long")
	}
	if len([]rune(department.Remark)) > 255 {
		return common.NewMessage("Department remark is too long")
	}
	if department.ParentId < 0 {
		return common.NewMessage("Invalid parent department")
	}
	return nil
}

// validateDepartmentPlacement enforces the tree depth, rejects cycles, and
// checks sibling name uniqueness for a department being created (id 0) or
// updated.
func validateDepartmentPlacement(tx *gorm.DB, department *Department) error {
	if department.ParentId != 0 {
		if department.ParentId == department.Id {
			return common.NewMessage("A department cannot be its own parent")
		}
		parents, err := departmentParents(tx)
		if err != nil {
			return err
		}
		parentChain := departmentChain(parents, department.ParentId)
		if parentChain == nil {
			return common.NewMessage("Parent department not found")
		}
		height := 1
		if department.Id != 0 {
			for _, ancestorId := range parentChain {
				if ancestorId == department.Id {
					return common.NewMessage("A department cannot be moved under its own sub-department")
				}
			}
			height = subtreeHeight(parents, department.Id)
		}
		if len(parentChain)+height > MaxDepartmentDepth {
			return common.NewMessage("Departments can have at most {{levels}} levels", map[string]any{"levels": MaxDepartmentDepth})
		}
	}
	var duplicates int64
	query := tx.Model(&Department{}).
		Where("parent_id = ? AND LOWER(name) = LOWER(?)", department.ParentId, department.Name)
	if department.Id != 0 {
		query = query.Where("id <> ?", department.Id)
	}
	if err := query.Count(&duplicates).Error; err != nil {
		return err
	}
	if duplicates > 0 {
		return common.NewMessage("A department with this name already exists at this level")
	}
	return nil
}

func CreateDepartment(department *Department) error {
	department.Id = 0
	if err := normalizeDepartmentInput(department); err != nil {
		return err
	}
	now := common.GetTimestamp()
	department.CreatedAt = now
	department.UpdatedAt = now
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := validateDepartmentPlacement(tx, department); err != nil {
			return err
		}
		return tx.Create(department).Error
	})
	if err != nil {
		return err
	}
	return ReloadDepartmentCache()
}

func UpdateDepartment(department *Department) error {
	if department.Id <= 0 {
		return common.NewMessage("Department not found")
	}
	if err := normalizeDepartmentInput(department); err != nil {
		return err
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var current Department
		if err := lockForUpdate(tx).First(&current, "id = ?", department.Id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewMessage("Department not found")
			}
			return err
		}
		if err := validateDepartmentPlacement(tx, department); err != nil {
			return err
		}
		return tx.Model(&Department{}).Where("id = ?", department.Id).Updates(map[string]any{
			"parent_id":  department.ParentId,
			"name":       department.Name,
			"sort":       department.Sort,
			"remark":     department.Remark,
			"updated_at": common.GetTimestamp(),
		}).Error
	})
	if err != nil {
		return err
	}
	return ReloadDepartmentCache()
}

// DeleteDepartment soft-deletes a department without sub-departments and
// moves its members to unassigned. Usage recorded earlier keeps the
// department id, so reports still attribute it to the deleted department.
func DeleteDepartment(id int) (int64, error) {
	var moved int64
	err := DB.Transaction(func(tx *gorm.DB) error {
		var current Department
		if err := lockForUpdate(tx).First(&current, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewMessage("Department not found")
			}
			return err
		}
		var children int64
		if err := tx.Model(&Department{}).Where("parent_id = ?", id).Count(&children).Error; err != nil {
			return err
		}
		if children > 0 {
			return common.NewMessage("Delete or move its sub-departments first")
		}
		result := tx.Unscoped().Model(&User{}).Where("department_id = ?", id).Update("department_id", 0)
		if result.Error != nil {
			return result.Error
		}
		moved = result.RowsAffected
		return tx.Delete(&Department{}, id).Error
	})
	if err != nil {
		return 0, err
	}
	return moved, ReloadDepartmentCache()
}

// SetUsersDepartment assigns users to a department; departmentId 0 unassigns
// them. Usage already recorded keeps the department it was recorded under.
func SetUsersDepartment(userIds []int, departmentId int) error {
	if len(userIds) == 0 {
		return nil
	}
	if departmentId < 0 {
		return common.NewMessage("Department not found")
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if departmentId != 0 {
			// Locks the department so a concurrent delete cannot leave users
			// pointing at it.
			var department Department
			if err := lockForUpdate(tx).First(&department, "id = ?", departmentId).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return common.NewMessage("Department not found")
				}
				return err
			}
		}
		return tx.Unscoped().Model(&User{}).Where("id IN ?", userIds).Update("department_id", departmentId).Error
	})
	if err != nil {
		return err
	}
	return ReloadDepartmentCache()
}

// Department filter kinds produced by ResolveDepartmentFilter.
const (
	departmentFilterAny        = "department"
	departmentFilterUnassigned = "unassigned"
)

// ResolveDepartmentFilter turns a department filter id into a filter kind
// and value for departmentCondition. A department matches usage recorded in
// it or anywhere below it, at whatever level it sat at the time, and
// DepartmentUnassigned matches usage with no department.
func ResolveDepartmentFilter(id int) (column string, value int, err error) {
	if id == 0 {
		return "", 0, nil
	}
	if id == DepartmentUnassigned {
		return departmentFilterUnassigned, 0, nil
	}
	var department Department
	if err := DB.Unscoped().First(&department, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", 0, common.NewMessage("Department not found")
		}
		return "", 0, err
	}
	return departmentFilterAny, id, nil
}

// departmentCondition is the WHERE condition of a filter from
// ResolveDepartmentFilter on a table with snapshot columns, prefixed by
// table. Matching every snapshot level keeps history after the tree changes.
func departmentCondition(table string, column string, value int) (string, []any, bool) {
	switch column {
	case departmentFilterUnassigned:
		return table + "department_id = 0", nil, true
	case departmentFilterAny:
		return "(" + table + "department_id = ? OR " + table + "top_department_id = ? OR " + table + "mid_department_id = ?)", []any{value, value, value}, true
	}
	return "", nil, false
}

// departmentReloadLock serializes reloads so a slower, older read can never
// replace a newer snapshot.
var departmentReloadLock sync.Mutex

var departmentCache = struct {
	sync.RWMutex
	users map[int]DepartmentSnapshot
}{users: map[int]DepartmentSnapshot{}}

func ReloadDepartmentCache() error {
	departmentReloadLock.Lock()
	defer departmentReloadLock.Unlock()
	parents, err := departmentParents(DB)
	if err != nil {
		return err
	}
	var users []struct {
		Id           int
		DepartmentId int
	}
	if err := DB.Model(&User{}).Select("id, department_id").Where("department_id <> 0").Scan(&users).Error; err != nil {
		return err
	}
	snapshots := make(map[int]DepartmentSnapshot, len(users))
	for _, user := range users {
		if snapshot := snapshotFromChain(departmentChain(parents, user.DepartmentId)); snapshot.DepartmentId != 0 {
			snapshots[user.Id] = snapshot
		}
	}
	departmentCache.Lock()
	departmentCache.users = snapshots
	departmentCache.Unlock()
	return nil
}

func GetUserDepartmentSnapshot(userId int) DepartmentSnapshot {
	departmentCache.RLock()
	defer departmentCache.RUnlock()
	return departmentCache.users[userId]
}

// SyncDepartmentCache reloads the department cache every frequency seconds.
func SyncDepartmentCache(frequency int) {
	for {
		time.Sleep(time.Duration(frequency) * time.Second)
		if err := ReloadDepartmentCache(); err != nil {
			common.SysError(common.LogText("failed to reload department cache: %s", err.Error()))
		}
	}
}
