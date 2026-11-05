package controller

import (
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// Dimensions each audience may group the dashboard report by. They match
// what the existing flow data exposes: channels for administrators, nodes
// and tokens across users for root only, and no department data for users.
var (
	selfReportDimensions  = []string{"model_name", "use_group", "token_id"}
	adminReportDimensions = []string{"model_name", "user_id", "department_id", "top_department_id", "mid_department_id", "use_group", "channel_id"}
	rootReportDimensions  = []string{"model_name", "user_id", "department_id", "top_department_id", "mid_department_id", "use_group", "channel_id", "token_id", "node_name"}
)

func quotaReportQueryFromRequest(c *gin.Context, allowed []string) (model.QuotaReportQuery, bool) {
	startTime, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTime, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	tzOffset, _ := strconv.Atoi(c.Query("tz_offset"))
	query := model.QuotaReportQuery{
		StartTime:   startTime,
		EndTime:     endTime,
		Granularity: c.Query("granularity"),
		TzOffset:    tzOffset,
	}
	for dimension := range strings.SplitSeq(c.Query("dimensions"), ",") {
		dimension = strings.TrimSpace(dimension)
		if dimension == "" {
			continue
		}
		if !slices.Contains(allowed, dimension) {
			common.ApiErrorT(c, "Invalid parameters")
			return query, false
		}
		query.Dimensions = append(query.Dimensions, dimension)
	}
	return query, true
}

// GetQuotaReport is the administrator dashboard report over all users.
func GetQuotaReport(c *gin.Context) {
	allowed := adminReportDimensions
	if c.GetInt("role") >= common.RoleRootUser {
		allowed = rootReportDimensions
	}
	query, ok := quotaReportQueryFromRequest(c, allowed)
	if !ok {
		return
	}
	departmentId, _ := strconv.Atoi(c.Query("department_id"))
	column, value, err := model.ResolveDepartmentFilter(departmentId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	query.DepartmentColumn, query.DepartmentValue = column, value
	if userId, _ := strconv.Atoi(c.Query("user_id")); userId > 0 {
		query.UserID = userId
	}
	query.Username = strings.TrimSpace(c.Query("username"))
	rows, err := model.GetQuotaReport(query)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}

// GetSelfQuotaReport is the same report limited to the signed-in user, with
// no department data.
func GetSelfQuotaReport(c *gin.Context) {
	query, ok := quotaReportQueryFromRequest(c, selfReportDimensions)
	if !ok {
		return
	}
	query.UserID = c.GetInt("id")
	rows, err := model.GetQuotaReport(query)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}
