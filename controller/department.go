package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// GetDepartments lists departments with member counts. include_deleted=true
// also returns soft-deleted departments, which reports use to name usage
// recorded before a department was removed.
func GetDepartments(c *gin.Context) {
	if c.Query("include_deleted") == "true" {
		departments, err := model.GetDepartments(true)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, departments)
		return
	}
	departments, err := model.GetDepartmentsWithMembers()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, departments)
}

type departmentRequest struct {
	Id       int    `json:"id"`
	ParentId int    `json:"parent_id"`
	Name     string `json:"name"`
	Sort     int    `json:"sort"`
	Remark   string `json:"remark"`
}

func (r departmentRequest) toDepartment() *model.Department {
	return &model.Department{
		Id:       r.Id,
		ParentId: r.ParentId,
		Name:     r.Name,
		Sort:     r.Sort,
		Remark:   r.Remark,
	}
}

func CreateDepartment(c *gin.Context) {
	var req departmentRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	department := req.toDepartment()
	if err := model.CreateDepartment(department); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, 0, "department.create", map[string]any{
		"department_id": department.Id,
		"name":          department.Name,
		"parent_id":     department.ParentId,
	})
	common.ApiSuccess(c, department)
}

func UpdateDepartment(c *gin.Context) {
	var req departmentRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.Id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	department := req.toDepartment()
	if err := model.UpdateDepartment(department); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, 0, "department.update", map[string]any{
		"department_id": department.Id,
		"name":          department.Name,
		"parent_id":     department.ParentId,
	})
	common.ApiSuccess(c, department)
}

func DeleteDepartment(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	moved, err := model.DeleteDepartment(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, 0, "department.delete", map[string]any{
		"department_id": id,
		"moved_members": moved,
	})
	common.ApiSuccess(c, gin.H{"moved_members": moved})
}

type setUsersDepartmentRequest struct {
	UserIds      []int `json:"user_ids"`
	DepartmentId int   `json:"department_id"`
}

const maxDepartmentBatchUsers = 1000

// SetUsersDepartment assigns one or more users to a department, or unassigns
// them with department_id 0. Administrators can only change users below
// their own role, like every other user management action.
func SetUsersDepartment(c *gin.Context) {
	var req setUsersDepartmentRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || len(req.UserIds) == 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if len(req.UserIds) > maxDepartmentBatchUsers {
		common.ApiErrorT(c, "Too many users selected")
		return
	}
	var targets []struct {
		Id   int
		Role int
	}
	if err := model.DB.Unscoped().Model(&model.User{}).Select("id, role").Where("id IN ?", req.UserIds).Scan(&targets).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	myRole := c.GetInt("role")
	userIds := make([]int, 0, len(targets))
	for _, target := range targets {
		if !canManageTargetRole(myRole, target.Role) {
			common.ApiErrorT(c, "No permission to access users of same or higher level")
			return
		}
		userIds = append(userIds, target.Id)
	}
	if len(userIds) == 0 {
		common.ApiErrorT(c, "User not found")
		return
	}
	if err := model.SetUsersDepartment(userIds, req.DepartmentId); err != nil {
		common.ApiError(c, err)
		return
	}
	for _, userId := range userIds {
		recordManageAuditFor(c, userId, "user.department", map[string]any{"department_id": req.DepartmentId})
	}
	common.ApiSuccess(c, gin.H{"updated": len(userIds)})
}
