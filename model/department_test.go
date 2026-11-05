package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupDepartmentTest(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Department{}))
	truncateTables(t)
	t.Cleanup(func() {
		DB.Exec("DELETE FROM departments")
		require.NoError(t, ReloadDepartmentCache())
		CacheQuotaDataLock.Lock()
		CacheQuotaData = make(map[string]*QuotaData)
		CacheQuotaDataLock.Unlock()
	})
}

func createTestDepartment(t *testing.T, name string, parentId int) *Department {
	t.Helper()
	department := &Department{Name: name, ParentId: parentId}
	require.NoError(t, CreateDepartment(department))
	return department
}

func createTestUser(t *testing.T, id int, username string, departmentId int) {
	t.Helper()
	require.NoError(t, DB.Create(&User{Id: id, Username: username, Password: "password", DepartmentId: departmentId, AffCode: username}).Error)
}

func TestDepartmentTreeIsLimitedToThreeLevels(t *testing.T) {
	setupDepartmentTest(t)
	rd := createTestDepartment(t, "R&D", 0)
	frontend := createTestDepartment(t, "Frontend", rd.Id)
	web := createTestDepartment(t, "Web", frontend.Id)
	sales := createTestDepartment(t, "Sales", 0)

	err := CreateDepartment(&Department{Name: "Too deep", ParentId: web.Id})
	assert.ErrorContains(t, err, "Departments can have at most 3 levels")

	// Moving a three-level subtree under another department would make four.
	err = UpdateDepartment(&Department{Id: rd.Id, Name: "R&D", ParentId: sales.Id})
	assert.ErrorContains(t, err, "Departments can have at most 3 levels")

	err = UpdateDepartment(&Department{Id: rd.Id, Name: "R&D", ParentId: web.Id})
	assert.ErrorContains(t, err, "A department cannot be moved under its own sub-department")

	// A two-level subtree fits under a top-level department.
	require.NoError(t, UpdateDepartment(&Department{Id: frontend.Id, Name: "Frontend", ParentId: sales.Id}))
	require.NoError(t, UpdateDepartment(&Department{Id: frontend.Id, Name: "Frontend", ParentId: rd.Id}))

	err = UpdateDepartment(&Department{Id: sales.Id, Name: "Sales", ParentId: sales.Id})
	assert.ErrorContains(t, err, "A department cannot be its own parent")

	// Sibling names are unique, the same name under another parent is fine.
	err = CreateDepartment(&Department{Name: "frontend", ParentId: rd.Id})
	assert.ErrorContains(t, err, "A department with this name already exists at this level")
	require.NoError(t, CreateDepartment(&Department{Name: "Frontend", ParentId: sales.Id}))

	// Moving a sub-department to another top-level department is allowed.
	require.NoError(t, UpdateDepartment(&Department{Id: frontend.Id, Name: "Frontend", ParentId: 0}))
}

func TestDeleteDepartmentUnassignsMembersAndKeepsName(t *testing.T) {
	setupDepartmentTest(t)
	rd := createTestDepartment(t, "R&D", 0)
	frontend := createTestDepartment(t, "Frontend", rd.Id)
	createTestUser(t, 1, "alice", frontend.Id)
	createTestUser(t, 2, "bob", frontend.Id)

	_, err := DeleteDepartment(rd.Id)
	assert.ErrorContains(t, err, "Delete or move its sub-departments first")

	moved, err := DeleteDepartment(frontend.Id)
	require.NoError(t, err)
	assert.Equal(t, int64(2), moved)

	var alice User
	require.NoError(t, DB.First(&alice, 1).Error)
	assert.Equal(t, 0, alice.DepartmentId)
	assert.Equal(t, DepartmentSnapshot{}, GetUserDepartmentSnapshot(1))

	all, err := GetDepartments(true)
	require.NoError(t, err)
	require.Len(t, all, 2)
	assert.True(t, all[1].Deleted)
	assert.Equal(t, "Frontend", all[1].Name)

	// A deleted department name can be reused.
	require.NoError(t, CreateDepartment(&Department{Name: "Frontend", ParentId: rd.Id}))
}

func TestDepartmentSnapshotFollowsUserAndTreeChanges(t *testing.T) {
	setupDepartmentTest(t)
	rd := createTestDepartment(t, "R&D", 0)
	frontend := createTestDepartment(t, "Frontend", rd.Id)
	sales := createTestDepartment(t, "Sales", 0)
	createTestUser(t, 1, "alice", 0)

	require.NoError(t, SetUsersDepartment([]int{1}, frontend.Id))
	assert.Equal(t, DepartmentSnapshot{DepartmentId: frontend.Id, TopDepartmentId: rd.Id, MidDepartmentId: frontend.Id}, GetUserDepartmentSnapshot(1))

	require.NoError(t, UpdateDepartment(&Department{Id: frontend.Id, Name: "Frontend", ParentId: sales.Id}))
	assert.Equal(t, DepartmentSnapshot{DepartmentId: frontend.Id, TopDepartmentId: sales.Id, MidDepartmentId: frontend.Id}, GetUserDepartmentSnapshot(1))

	require.NoError(t, SetUsersDepartment([]int{1}, rd.Id))
	assert.Equal(t, DepartmentSnapshot{DepartmentId: rd.Id, TopDepartmentId: rd.Id}, GetUserDepartmentSnapshot(1))

	require.NoError(t, SetUsersDepartment([]int{1}, 0))
	assert.Equal(t, DepartmentSnapshot{}, GetUserDepartmentSnapshot(1))

	assert.ErrorContains(t, SetUsersDepartment([]int{1}, 9999), "Department not found")
}

func TestUserUpdateDoesNotChangeDepartment(t *testing.T) {
	setupDepartmentTest(t)
	rd := createTestDepartment(t, "R&D", 0)
	createTestUser(t, 1, "alice", rd.Id)

	user := &User{Id: 1, Username: "alice", DisplayName: "Alice", DepartmentId: rd.Id + 100}
	require.NoError(t, user.Update(false))

	var stored User
	require.NoError(t, DB.First(&stored, 1).Error)
	assert.Equal(t, rd.Id, stored.DepartmentId)
}

func TestSearchUsersByDepartmentIncludesSubDepartments(t *testing.T) {
	setupDepartmentTest(t)
	rd := createTestDepartment(t, "R&D", 0)
	frontend := createTestDepartment(t, "Frontend", rd.Id)
	createTestUser(t, 1, "alice", rd.Id)
	createTestUser(t, 2, "bob", frontend.Id)
	createTestUser(t, 3, "carol", 0)

	usernames := func(departmentId int) []string {
		users, _, err := SearchUsers("", "", departmentId, nil, nil, 0, 10, NewUserSortOptions("id", "asc"))
		require.NoError(t, err)
		names := make([]string, 0, len(users))
		for _, user := range users {
			names = append(names, user.Username)
		}
		return names
	}
	assert.Equal(t, []string{"alice", "bob"}, usernames(rd.Id))
	assert.Equal(t, []string{"bob"}, usernames(frontend.Id))
	assert.Equal(t, []string{"carol"}, usernames(DepartmentUnassigned))
}

// A user who moves from department A to B mid-month keeps the usage of each
// period in the department it happened in, for both logs and dashboard data.
func TestUsageKeepsDepartmentAtRecordTime(t *testing.T) {
	setupDepartmentTest(t)
	common.DataExportEnabled = true
	a := createTestDepartment(t, "A", 0)
	b := createTestDepartment(t, "B", 0)
	createTestUser(t, 1, "alice", a.Id)
	require.NoError(t, ReloadDepartmentCache())

	hour := int64(1_700_000_000 - 1_700_000_000%3600)
	record := func() {
		LogQuotaData(QuotaDataLogParams{UserID: 1, Username: "alice", ModelName: "gpt", Quota: 10, CreatedAt: hour, Department: GetUserDepartmentSnapshot(1)})
	}
	record()
	SaveQuotaDataCache()
	record()
	require.NoError(t, SetUsersDepartment([]int{1}, b.Id))
	record()
	record()
	SaveQuotaDataCache()

	rows, err := GetQuotaReport(QuotaReportQuery{
		StartTime: hour, EndTime: hour + 3600, Dimensions: []string{"top_department_id", "user_id"},
	})
	require.NoError(t, err)
	quotaByDepartment := map[int]int64{}
	for _, row := range rows {
		quotaByDepartment[row.TopDepartmentId] += row.Quota
		assert.Equal(t, "alice", row.Username)
	}
	assert.Equal(t, map[int]int64{a.Id: 20, b.Id: 20}, quotaByDepartment)

	filtered, err := GetQuotaReport(QuotaReportQuery{
		StartTime: hour, EndTime: hour + 3600, Dimensions: []string{"user_id"},
		DepartmentColumn: departmentFilterAny, DepartmentValue: a.Id,
	})
	require.NoError(t, err)
	require.Len(t, filtered, 1)
	assert.Equal(t, int64(20), filtered[0].Quota)
}

func TestUserLogsHideDepartment(t *testing.T) {
	setupDepartmentTest(t)
	require.NoError(t, LOG_DB.Create(&Log{UserId: 1, Type: LogTypeConsume, CreatedAt: 100, DepartmentId: 5, TopDepartmentId: 4}).Error)

	logs, _, err := GetUserLogs(1, LogFilter{}, 0, 10)
	require.NoError(t, err)
	require.Len(t, logs, 1)
	assert.Zero(t, logs[0].DepartmentId)
	assert.Zero(t, logs[0].TopDepartmentId)

	adminLogs, _, err := GetAllLogs(LogFilter{DepartmentColumn: departmentFilterAny, DepartmentValue: 4}, 0, 10)
	require.NoError(t, err)
	require.Len(t, adminLogs, 1)
	assert.Equal(t, 5, adminLogs[0].DepartmentId)

	none, _, err := GetAllLogs(LogFilter{DepartmentColumn: departmentFilterUnassigned}, 0, 10)
	require.NoError(t, err)
	assert.Empty(t, none)
}

func TestQuotaReportCalendarBuckets(t *testing.T) {
	setupDepartmentTest(t)
	shanghai := time.FixedZone("UTC+8", 8*3600)
	at := func(year int, month time.Month, day, hour int) int64 {
		return time.Date(year, month, day, hour, 0, 0, 0, shanghai).Unix()
	}
	// 2024 is a leap year; Feb 29 and Mar 31 23:00 local are the edge cases.
	for _, createdAt := range []int64{
		at(2024, time.February, 29, 0),
		at(2024, time.March, 31, 23),
		at(2024, time.April, 1, 0),
		at(2024, time.April, 1, 7),
	} {
		require.NoError(t, DB.Create(&QuotaData{UserID: 1, Username: "alice", ModelName: "gpt", CreatedAt: createdAt, Count: 1, Quota: 10}).Error)
	}
	report := func(granularity string) map[int64]int64 {
		rows, err := GetQuotaReport(QuotaReportQuery{
			StartTime:   at(2024, time.January, 1, 0),
			EndTime:     at(2024, time.December, 31, 23),
			Granularity: granularity,
			TzOffset:    8 * 3600,
			Dimensions:  []string{"model_name"},
		})
		require.NoError(t, err)
		quota := map[int64]int64{}
		for _, row := range rows {
			quota[row.CreatedAt] += row.Quota
		}
		return quota
	}
	assert.Equal(t, map[int64]int64{
		at(2024, time.February, 29, 0): 10,
		at(2024, time.March, 31, 0):    10,
		at(2024, time.April, 1, 0):     20,
	}, report(ReportGranularityDay))
	// 2024-02-26 and 2024-03-25 and 2024-04-01 are Mondays.
	assert.Equal(t, map[int64]int64{
		at(2024, time.February, 26, 0): 10,
		at(2024, time.March, 25, 0):    10,
		at(2024, time.April, 1, 0):     20,
	}, report(ReportGranularityWeek))
	assert.Equal(t, map[int64]int64{
		at(2024, time.February, 1, 0): 10,
		at(2024, time.March, 1, 0):    10,
		at(2024, time.April, 1, 0):    20,
	}, report(ReportGranularityMonth))
	assert.Equal(t, map[int64]int64{
		at(2024, time.January, 1, 0): 20,
		at(2024, time.April, 1, 0):   20,
	}, report(ReportGranularityQuarter))
	assert.Equal(t, map[int64]int64{0: 40}, report(ReportGranularityTotal))
}

func TestQuotaReportRejectsInvalidQueries(t *testing.T) {
	base := QuotaReportQuery{StartTime: 1000, EndTime: 2000, Dimensions: []string{"model_name"}}
	cases := map[string]func(q *QuotaReportQuery){
		"range too long": func(q *QuotaReportQuery) { q.EndTime = q.StartTime + ReportMaxRangeSeconds + 1 },
		"hourly too long": func(q *QuotaReportQuery) {
			q.Granularity = ReportGranularityHour
			q.EndTime = q.StartTime + ReportMaxHourRangeSeconds + 1
		},
		"bad granularity":  func(q *QuotaReportQuery) { q.Granularity = "minute" },
		"bad dimension":    func(q *QuotaReportQuery) { q.Dimensions = []string{"quota; DROP TABLE users"} },
		"bad tz offset":    func(q *QuotaReportQuery) { q.TzOffset = 15 * 3600 },
		"bad department":   func(q *QuotaReportQuery) { q.DepartmentColumn = "id" },
		"reversed range":   func(q *QuotaReportQuery) { q.EndTime = q.StartTime - 1 },
		"empty dimensions": func(q *QuotaReportQuery) { q.Dimensions = nil },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			q := base
			mutate(&q)
			_, err := GetQuotaReport(q)
			assert.Error(t, err)
		})
	}
}

// Promoting a sub-department to top level keeps its earlier usage under it.
func TestTopLevelFilterIncludesUsageFromBeforePromotion(t *testing.T) {
	setupDepartmentTest(t)
	rd := createTestDepartment(t, "R&D", 0)
	frontend := createTestDepartment(t, "Frontend", rd.Id)
	require.NoError(t, DB.Create(&QuotaData{UserID: 1, Username: "alice", ModelName: "gpt", CreatedAt: 3600, Count: 1, Quota: 10, DepartmentId: frontend.Id, TopDepartmentId: rd.Id}).Error)
	require.NoError(t, UpdateDepartment(&Department{Id: frontend.Id, Name: "Frontend", ParentId: 0}))
	require.NoError(t, DB.Create(&QuotaData{UserID: 1, Username: "alice", ModelName: "gpt", CreatedAt: 7200, Count: 1, Quota: 5, DepartmentId: frontend.Id, TopDepartmentId: frontend.Id}).Error)

	column, value, err := ResolveDepartmentFilter(frontend.Id)
	require.NoError(t, err)
	rows, err := GetQuotaReport(QuotaReportQuery{StartTime: 3600, EndTime: 7200, Dimensions: []string{"model_name"}, DepartmentColumn: column, DepartmentValue: value})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, int64(15), rows[0].Quota)

	// The former parent still reports the usage from before the move.
	column, value, err = ResolveDepartmentFilter(rd.Id)
	require.NoError(t, err)
	rows, err = GetQuotaReport(QuotaReportQuery{StartTime: 3600, EndTime: 7200, Dimensions: []string{"model_name"}, DepartmentColumn: column, DepartmentValue: value})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, int64(10), rows[0].Quota)
}

func TestUnassignedLogFilterSkipsAccountLogs(t *testing.T) {
	setupDepartmentTest(t)
	require.NoError(t, LOG_DB.Create(&Log{UserId: 1, Type: LogTypeTopup, CreatedAt: 100}).Error)
	require.NoError(t, LOG_DB.Create(&Log{UserId: 1, Type: LogTypeError, CreatedAt: 101}).Error)

	logs, _, err := GetAllLogs(LogFilter{DepartmentColumn: departmentFilterUnassigned}, 0, 10)
	require.NoError(t, err)
	require.Len(t, logs, 1)
	assert.Equal(t, LogTypeError, logs[0].Type)
}

func TestQuotaReportStartInsideHourKeepsThatHour(t *testing.T) {
	setupDepartmentTest(t)
	require.NoError(t, DB.Create(&QuotaData{UserID: 1, Username: "alice", ModelName: "gpt", CreatedAt: 36000, Count: 1, Quota: 7}).Error)

	rows, err := GetQuotaReport(QuotaReportQuery{StartTime: 36000 + 1800, EndTime: 40000, Dimensions: []string{"model_name"}})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, int64(7), rows[0].Quota)
}

func TestThreeLevelSnapshotAndFilters(t *testing.T) {
	setupDepartmentTest(t)
	rd := createTestDepartment(t, "R&D", 0)
	frontend := createTestDepartment(t, "Frontend", rd.Id)
	web := createTestDepartment(t, "Web", frontend.Id)
	createTestUser(t, 1, "alice", web.Id)
	createTestUser(t, 2, "bob", frontend.Id)
	createTestUser(t, 3, "carol", rd.Id)
	require.NoError(t, ReloadDepartmentCache())

	assert.Equal(t, DepartmentSnapshot{DepartmentId: web.Id, TopDepartmentId: rd.Id, MidDepartmentId: frontend.Id}, GetUserDepartmentSnapshot(1))
	assert.Equal(t, DepartmentSnapshot{DepartmentId: frontend.Id, TopDepartmentId: rd.Id, MidDepartmentId: frontend.Id}, GetUserDepartmentSnapshot(2))
	assert.Equal(t, DepartmentSnapshot{DepartmentId: rd.Id, TopDepartmentId: rd.Id}, GetUserDepartmentSnapshot(3))

	for userId, quota := range map[int]int{1: 10, 2: 20, 3: 40} {
		require.NoError(t, DB.Create(&QuotaData{UserID: userId, Username: "u", ModelName: "gpt", CreatedAt: 3600, Count: 1, Quota: quota, DepartmentId: GetUserDepartmentSnapshot(userId).DepartmentId, TopDepartmentId: GetUserDepartmentSnapshot(userId).TopDepartmentId, MidDepartmentId: GetUserDepartmentSnapshot(userId).MidDepartmentId}).Error)
	}
	quotaOf := func(departmentId int) int64 {
		column, value, err := ResolveDepartmentFilter(departmentId)
		require.NoError(t, err)
		rows, err := GetQuotaReport(QuotaReportQuery{StartTime: 3600, EndTime: 3600, Dimensions: []string{"model_name"}, DepartmentColumn: column, DepartmentValue: value})
		require.NoError(t, err)
		var total int64
		for _, row := range rows {
			total += row.Quota
		}
		return total
	}
	assert.Equal(t, int64(70), quotaOf(rd.Id))
	assert.Equal(t, int64(30), quotaOf(frontend.Id))
	assert.Equal(t, int64(10), quotaOf(web.Id))

	users, _, err := SearchUsers("", "", frontend.Id, nil, nil, 0, 10, NewUserSortOptions("id", "asc"))
	require.NoError(t, err)
	require.Len(t, users, 2)
	assert.Equal(t, "alice", users[0].Username)
}
