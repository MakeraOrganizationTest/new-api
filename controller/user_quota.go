package controller

import (
	"errors"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func manageUserQuota(c *gin.Context, req ManageRequest) {
	action := "generic"
	params := model.AuditFields{
		"target_user_id":  req.Id,
		"mode":            req.Mode,
		"requested_quota": req.Value,
	}
	switch req.Mode {
	case "add":
		action = "user.quota_add"
	case "subtract":
		action = "user.quota_subtract"
	case "override":
		action = "user.quota_override"
	default:
		params["action"] = "add_quota"
		params["method"] = c.Request.Method
		params["route"] = c.FullPath()
	}
	success := false
	defer func() {
		content := auditContentEN(action, params)
		if !success {
			// Failed requests have no committed balance changes to render.
			content = "Failed user quota adjustment"
		}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), action, params,
			auditOperatorInfo(c), &model.AuditRequestInfo{
				Method: c.Request.Method, Route: c.FullPath(), Status: c.Writer.Status(), Success: success,
			}, c)
		markAuditLogged(c)
	}()

	adjustment, err := model.AdjustUserQuota(req.Id, c.GetInt("role"), req.Mode, req.Value)
	if err != nil {
		switch {
		case errors.Is(err, model.ErrInvalidUserQuotaAdjustment):
			params["failure_reason"] = "invalid_parameters"
			if (req.Mode == "add" || req.Mode == "subtract") && req.Value <= 0 {
				common.ApiErrorT(c, "Quota change amount cannot be zero")
			} else {
				common.ApiErrorT(c, "Invalid parameters")
			}
		case errors.Is(err, model.ErrUserQuotaPermission):
			params["failure_reason"] = "permission_denied"
			common.ApiErrorT(c, "No permission to update users of same or higher permission level")
		case errors.Is(err, gorm.ErrRecordNotFound):
			params["failure_reason"] = "target_not_found"
			common.ApiErrorT(c, "User does not exist")
		case errors.Is(err, model.ErrWalletQuotaLimitExceeded):
			params["failure_reason"] = "quota_limit_exceeded"
			common.ApiError(c, err)
		default:
			params["failure_reason"] = "database_error"
			common.ApiError(c, err)
		}
		return
	}

	params["target_username"] = adjustment.Username
	params["from"] = adjustment.Before
	params["to"] = adjustment.After
	if req.Mode != "override" {
		params["quota"] = req.Value
	}
	success = true
	operation := model.AuditOperation{Action: action, Params: params}
	model.RecordLogWithAdminInfo(adjustment.UserID, model.LogTypeTopup,
		auditContentEN(action, params), auditOperatorInfo(c), &operation, c)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

const maxQuotaGrantRemarkLength = 64

type batchQuotaGrantRequest struct {
	Scope         string `json:"scope"`
	DepartmentIds []int  `json:"department_ids"`
	UserIds       []int  `json:"user_ids"`
	Mode          string `json:"mode"`
	Value         int    `json:"value"`
	Remark        string `json:"remark"`
}

type batchQuotaGrantFailure struct {
	UserId   int    `json:"user_id"`
	Username string `json:"username"`
}

// BatchAdjustUserQuota adds to, or sets, the wallet quota of every user in a
// scope: all enabled users, the enabled members of departments, or a list of
// users. Each user is adjusted on its own and gets the same top-up log as a
// single manual adjustment; one operation audit log summarizes the batch.
// Users the operator cannot manage are skipped.
func BatchAdjustUserQuota(c *gin.Context) {
	var req batchQuotaGrantRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	req.Remark = strings.TrimSpace(req.Remark)
	if (req.Mode != "add" && req.Mode != "override") || req.Value < 0 || (req.Mode == "add" && req.Value == 0) {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if len([]rune(req.Remark)) > maxQuotaGrantRemarkLength {
		common.ApiErrorT(c, "Remark is too long")
		return
	}
	if req.Value > common.MaxWalletQuota {
		common.ApiError(c, model.ErrWalletQuotaLimitExceeded)
		return
	}
	targets, err := model.FindQuotaGrantTargets(req.Scope, req.DepartmentIds, req.UserIds)
	if errors.Is(err, model.ErrInvalidUserQuotaAdjustment) {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(targets) == 0 {
		common.ApiErrorT(c, "No users match the selected scope")
		return
	}

	action := "user.quota_add"
	if req.Mode == "override" {
		action = "user.quota_override"
	}
	myRole := c.GetInt("role")
	operator := auditOperatorInfo(c)
	succeeded, skipped := 0, 0
	failures := make([]batchQuotaGrantFailure, 0)
	for _, target := range targets {
		if !canManageTargetRole(myRole, target.Role) {
			skipped++
			continue
		}
		adjustment, err := model.AdjustUserQuota(target.Id, myRole, req.Mode, req.Value)
		if err != nil {
			common.SysError(common.LogText("batch quota adjustment failed for user %d: %s", target.Id, err.Error()))
			failures = append(failures, batchQuotaGrantFailure{UserId: target.Id, Username: target.Username})
			continue
		}
		succeeded++
		params := model.AuditFields{
			"target_user_id":  adjustment.UserID,
			"target_username": adjustment.Username,
			"mode":            req.Mode,
			"requested_quota": req.Value,
			"from":            adjustment.Before,
			"to":              adjustment.After,
			"batch":           true,
		}
		if req.Mode == "add" {
			params["quota"] = req.Value
		}
		if req.Remark != "" {
			params["remark"] = req.Remark
		}
		operation := model.AuditOperation{Action: action, Params: params}
		model.RecordLogWithAdminInfo(adjustment.UserID, model.LogTypeTopup,
			auditContentEN(action, params), operator, &operation, c)
	}

	summary := map[string]any{
		"scope":     req.Scope,
		"mode":      req.Mode,
		"quota":     req.Value,
		"total":     len(targets),
		"succeeded": succeeded,
		"skipped":   skipped,
		"failed":    len(failures),
	}
	if req.Scope == model.QuotaGrantScopeDepartments {
		summary["department_ids"] = req.DepartmentIds
	}
	if req.Remark != "" {
		summary["remark"] = req.Remark
	}
	model.RecordOperationAuditLog(c.GetInt("id"), myRole, auditContentEN("user.quota_batch", summary), c.ClientIP(),
		"user.quota_batch", summary, operator, &model.AuditRequestInfo{
			Method: c.Request.Method, Route: c.FullPath(), Status: http.StatusOK, Success: succeeded > 0,
		}, c)
	markAuditLogged(c)
	common.ApiSuccess(c, gin.H{
		"total":     len(targets),
		"succeeded": succeeded,
		"skipped":   skipped,
		"failed":    failures,
	})
}
