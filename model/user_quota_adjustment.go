package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

var (
	ErrInvalidUserQuotaAdjustment = errors.New("invalid user quota adjustment")
	ErrUserQuotaPermission        = errors.New("cannot adjust quota for this user role")
)

// UserQuotaAdjustment is the immutable database snapshot of a committed manual
// adjustment. Pending relay deductions in the quota cache are not part of it.
type UserQuotaAdjustment struct {
	UserID   int
	Username string
	Before   int
	After    int
}

func AdjustUserQuota(userID, operatorRole int, mode string, value int) (*UserQuotaAdjustment, error) {
	if userID <= 0 || (mode != "add" && mode != "subtract" && mode != "override") {
		return nil, ErrInvalidUserQuotaAdjustment
	}
	if mode != "override" && value <= 0 {
		return nil, ErrInvalidUserQuotaAdjustment
	}
	if value > common.MaxWalletQuota || value < -common.MaxWalletQuota {
		return nil, ErrWalletQuotaLimitExceeded
	}

	var adjustment UserQuotaAdjustment
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		if operatorRole != common.RoleRootUser && operatorRole <= user.Role {
			return ErrUserQuotaPermission
		}
		if user.Quota > common.MaxWalletQuota || user.Quota < -common.MaxWalletQuota {
			return ErrWalletQuotaLimitExceeded
		}
		quota := decimal.NewFromInt(int64(value))
		switch mode {
		case "add":
			quota = decimal.NewFromInt(int64(user.Quota)).Add(quota)
		case "subtract":
			quota = decimal.NewFromInt(int64(user.Quota)).Sub(quota)
		}
		after, err := common.WalletQuotaFromDecimalStrict(quota)
		if err != nil {
			return ErrWalletQuotaLimitExceeded
		}
		// An unchanged override is a successful operation, including on MySQL
		// configurations that count only changed rows in RowsAffected.
		if after != user.Quota {
			result := tx.Model(&User{}).Where("id = ?", userID).Update("quota", after)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
		}
		adjustment = UserQuotaAdjustment{UserID: user.Id, Username: user.Username, Before: user.Quota, After: after}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Apply only the committed difference, preserving outstanding reservations.
	// Both balances are bounded above, so their difference fits in int64.
	delta := int64(adjustment.After) - int64(adjustment.Before)
	if delta != 0 {
		if err := cacheIncrUserQuota(userID, delta); err != nil {
			common.SysError(common.LogText("failed to sync manual quota adjustment for user %d: %s", userID, err))
		}
	}
	return &adjustment, nil
}

// Scopes a batch quota grant can target.
const (
	QuotaGrantScopeAll         = "all"
	QuotaGrantScopeDepartments = "departments"
	QuotaGrantScopeUsers       = "users"
)

// QuotaGrantTarget is a user selected by a batch quota grant.
type QuotaGrantTarget struct {
	Id       int
	Username string
	Role     int
}

// FindQuotaGrantTargets resolves a batch grant scope to users ordered by id.
// The all-users and department scopes take enabled users only, and a
// department includes every department below it. An explicit user list is
// taken as given, disabled users included.
func FindQuotaGrantTargets(scope string, departmentIds, userIds []int) ([]QuotaGrantTarget, error) {
	query := DB.Model(&User{}).Select("id, username, role").Order("id")
	switch scope {
	case QuotaGrantScopeAll:
		query = query.Where("status = ?", common.UserStatusEnabled)
	case QuotaGrantScopeDepartments:
		if len(departmentIds) == 0 {
			return nil, ErrInvalidUserQuotaAdjustment
		}
		parents, err := departmentParents(DB)
		if err != nil {
			return nil, err
		}
		ids := make([]int, 0, len(departmentIds))
		for _, departmentId := range departmentIds {
			ids = append(ids, descendantDepartmentIds(parents, departmentId)...)
		}
		query = query.Where("status = ? AND department_id IN ?", common.UserStatusEnabled, ids)
	case QuotaGrantScopeUsers:
		if len(userIds) == 0 {
			return nil, ErrInvalidUserQuotaAdjustment
		}
		query = query.Where("id IN ?", userIds)
	default:
		return nil, ErrInvalidUserQuotaAdjustment
	}
	var targets []QuotaGrantTarget
	if err := query.Scan(&targets).Error; err != nil {
		return nil, err
	}
	return targets, nil
}
