package model

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Report granularities. "total" sums the whole range without time buckets.
const (
	ReportGranularityTotal   = "total"
	ReportGranularityHour    = "hour"
	ReportGranularityDay     = "day"
	ReportGranularityWeek    = "week"
	ReportGranularityMonth   = "month"
	ReportGranularityQuarter = "quarter"
)

const (
	// ReportMaxRangeSeconds covers two calendar years, so "last year" fits
	// even when it is a leap year.
	ReportMaxRangeSeconds = 731 * 24 * 3600
	// ReportMaxHourRangeSeconds bounds hourly buckets to keep responses small.
	ReportMaxHourRangeSeconds = 31 * 24 * 3600
	reportMaxTzOffsetSeconds  = 14 * 3600
)

// Report dimensions map request names to quota_data columns.
var reportDimensionColumns = map[string]string{
	"model_name":        "model_name",
	"user_id":           "user_id",
	"department_id":     "department_id",
	"top_department_id": "top_department_id",
	"mid_department_id": "mid_department_id",
	"use_group":         "use_group",
	"token_id":          "token_id",
	"channel_id":        "channel_id",
	"node_name":         "node_name",
}

// QuotaReportQuery is an aggregation over the dashboard table quota_data.
type QuotaReportQuery struct {
	StartTime   int64
	EndTime     int64
	Granularity string
	// TzOffset is the viewer's offset east of UTC in seconds; day, week,
	// month and quarter buckets start at the viewer's local midnight.
	TzOffset   int
	Dimensions []string
	// UserID limits the report to one user (the self dashboard).
	UserID int
	// Username limits the report to usage recorded under this username.
	Username         string
	DepartmentColumn string
	DepartmentValue  int
}

type QuotaReportRow struct {
	CreatedAt           int64  `json:"created_at,omitempty" gorm:"column:bucket"`
	ModelName           string `json:"model_name,omitempty" gorm:"column:model_name"`
	UserID              int    `json:"user_id,omitempty" gorm:"column:user_id"`
	Username            string `json:"username,omitempty" gorm:"column:username"`
	DisplayName         string `json:"display_name,omitempty" gorm:"-"`
	UserDeleted         bool   `json:"user_deleted,omitempty" gorm:"-"`
	DepartmentId        int    `json:"department_id,omitempty" gorm:"column:department_id"`
	TopDepartmentId     int    `json:"top_department_id,omitempty" gorm:"column:top_department_id"`
	MidDepartmentId     int    `json:"mid_department_id,omitempty" gorm:"column:mid_department_id"`
	UseGroup            string `json:"use_group,omitempty" gorm:"column:use_group"`
	TokenID             int    `json:"token_id,omitempty" gorm:"column:token_id"`
	TokenName           string `json:"token_name,omitempty" gorm:"-"`
	ChannelID           int    `json:"channel_id,omitempty" gorm:"column:channel_id"`
	ChannelName         string `json:"channel_name,omitempty" gorm:"-"`
	NodeName            string `json:"node_name,omitempty" gorm:"column:node_name"`
	Count               int64  `json:"count" gorm:"column:count"`
	Quota               int64  `json:"quota" gorm:"column:quota"`
	TokenUsed           int64  `json:"token_used" gorm:"column:token_used"`
	CacheReadTokens     int64  `json:"cache_read_tokens" gorm:"column:cache_read_tokens"`
	CacheCreationTokens int64  `json:"cache_creation_tokens" gorm:"column:cache_creation_tokens"`
}

func (q *QuotaReportQuery) validate() error {
	if q.StartTime <= 0 || q.EndTime <= 0 || q.EndTime < q.StartTime {
		return common.NewMessage("Invalid time range")
	}
	if q.EndTime-q.StartTime > ReportMaxRangeSeconds {
		return common.NewMessage("The time range cannot exceed {{days}} days", map[string]any{"days": ReportMaxRangeSeconds / 86400})
	}
	// quota_data rows start on the hour, so a start inside an hour keeps that
	// hour's usage instead of silently dropping it.
	q.StartTime -= q.StartTime % 3600
	if q.TzOffset < -reportMaxTzOffsetSeconds || q.TzOffset > reportMaxTzOffsetSeconds {
		return common.NewMessage("Invalid time zone")
	}
	switch q.Granularity {
	case "":
		q.Granularity = ReportGranularityTotal
	case ReportGranularityHour:
		if q.EndTime-q.StartTime > ReportMaxHourRangeSeconds {
			return common.NewMessage("Hourly data is limited to {{days}} days", map[string]any{"days": ReportMaxHourRangeSeconds / 86400})
		}
	case ReportGranularityTotal, ReportGranularityDay, ReportGranularityWeek, ReportGranularityMonth, ReportGranularityQuarter:
	default:
		return common.NewMessage("Invalid granularity")
	}
	if len(q.Dimensions) == 0 {
		return common.NewMessage("Invalid parameters")
	}
	for _, dimension := range q.Dimensions {
		if _, ok := reportDimensionColumns[dimension]; !ok {
			return common.NewMessage("Invalid parameters")
		}
	}
	switch q.DepartmentColumn {
	case "", departmentFilterAny, departmentFilterUnassigned:
	default:
		return common.NewMessage("Invalid parameters")
	}
	return nil
}

// reportBucketExpression returns the SQL bucket start for a granularity.
// quota_data.created_at is already aligned to the hour, so day and week
// buckets need only integer arithmetic, which behaves the same on SQLite,
// MySQL, and PostgreSQL. Month and quarter are merged from day buckets in Go
// because month lengths vary. The offset is a validated int, never user text.
func reportBucketExpression(granularity string, tzOffset int) string {
	switch granularity {
	case ReportGranularityHour:
		return "created_at"
	case ReportGranularityWeek:
		// 1970-01-01 was a Thursday; shifting by three days starts weeks on Monday.
		return fmt.Sprintf("created_at - ((created_at + %d) %% 604800)", tzOffset+3*86400)
	default:
		return fmt.Sprintf("created_at - ((created_at + %d) %% 86400)", tzOffset)
	}
}

// GetQuotaReport aggregates quota_data by the requested dimensions and time
// granularity, and fills display names for users, tokens, and channels.
func GetQuotaReport(q QuotaReportQuery) ([]*QuotaReportRow, error) {
	if err := q.validate(); err != nil {
		return nil, err
	}
	dimensions := slices.Clone(q.Dimensions)
	slices.Sort(dimensions)
	dimensions = slices.Compact(dimensions)

	selects := make([]string, 0, len(dimensions)+7)
	groups := make([]string, 0, len(dimensions)+1)
	for _, dimension := range dimensions {
		column := reportDimensionColumns[dimension]
		selects = append(selects, column)
		groups = append(groups, column)
	}
	if slices.Contains(dimensions, "user_id") {
		// Grouping by user id keeps a renamed user in one row.
		selects = append(selects, "MAX(username) as username")
	}
	bucketed := q.Granularity != ReportGranularityTotal
	if bucketed {
		selects = append(selects, reportBucketExpression(q.Granularity, q.TzOffset)+" as bucket")
		groups = append(groups, "bucket")
	}
	selects = append(selects,
		"sum(count) as count",
		"sum(quota) as quota",
		"sum(token_used) as token_used",
		"sum(cache_read_tokens) as cache_read_tokens",
		"sum(cache_creation_tokens) as cache_creation_tokens",
	)

	query := DB.Table("quota_data").
		Select(strings.Join(selects, ", ")).
		Where("created_at >= ? AND created_at <= ?", q.StartTime, q.EndTime)
	if q.UserID > 0 {
		query = query.Where("user_id = ?", q.UserID)
	}
	if q.Username != "" {
		query = query.Where("username = ?", q.Username)
	}
	if condition, args, ok := departmentCondition("", q.DepartmentColumn, q.DepartmentValue); ok {
		query = query.Where(condition, args...)
	}
	query = query.Group(strings.Join(groups, ", "))
	if bucketed {
		query = query.Order("bucket asc")
	}
	rows := make([]*QuotaReportRow, 0)
	if err := query.Scan(&rows).Error; err != nil {
		common.SysError(common.LogText("failed to query dashboard report: %s", err.Error()))
		return nil, common.NewMessage("Failed to query statistics")
	}
	if q.Granularity == ReportGranularityMonth || q.Granularity == ReportGranularityQuarter {
		rows = mergeReportCalendarBuckets(rows, q.Granularity, q.TzOffset)
	}
	if err := fillQuotaReportNames(DB, rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// mergeReportCalendarBuckets folds day buckets into month or quarter buckets
// in the viewer's time zone, keeping the order of first appearance.
func mergeReportCalendarBuckets(rows []*QuotaReportRow, granularity string, tzOffset int) []*QuotaReportRow {
	zone := time.FixedZone("report", tzOffset)
	merged := make([]*QuotaReportRow, 0, len(rows))
	index := make(map[QuotaReportRow]*QuotaReportRow, len(rows))
	for _, row := range rows {
		day := time.Unix(row.CreatedAt, 0).In(zone)
		month := day.Month()
		if granularity == ReportGranularityQuarter {
			month = time.Month((int(month)-1)/3*3 + 1)
		}
		key := *row
		key.CreatedAt = time.Date(day.Year(), month, 1, 0, 0, 0, 0, zone).Unix()
		key.Count, key.Quota, key.TokenUsed, key.CacheReadTokens, key.CacheCreationTokens = 0, 0, 0, 0, 0
		key.Username = ""
		target, ok := index[key]
		if !ok {
			copied := *row
			copied.CreatedAt = key.CreatedAt
			target = &copied
			index[key] = target
			merged = append(merged, target)
			continue
		}
		target.Count += row.Count
		target.Quota += row.Quota
		target.TokenUsed += row.TokenUsed
		target.CacheReadTokens += row.CacheReadTokens
		target.CacheCreationTokens += row.CacheCreationTokens
	}
	return merged
}

// fillQuotaReportNames adds current display names. Deleted users, tokens,
// and channels are included so historical usage stays readable.
func fillQuotaReportNames(db *gorm.DB, rows []*QuotaReportRow) error {
	userIds := make(map[int]struct{})
	tokenIds := make(map[int]struct{})
	channelIds := make(map[int]struct{})
	for _, row := range rows {
		if row.UserID != 0 {
			userIds[row.UserID] = struct{}{}
		}
		if row.TokenID != 0 {
			tokenIds[row.TokenID] = struct{}{}
		}
		if row.ChannelID != 0 {
			channelIds[row.ChannelID] = struct{}{}
		}
	}
	type userName struct {
		Id          int
		Username    string
		DisplayName string
		DeletedAt   gorm.DeletedAt
	}
	users := make(map[int]userName, len(userIds))
	if len(userIds) > 0 {
		var found []userName
		if err := db.Unscoped().Model(&User{}).Select("id, username, display_name, deleted_at").
			Where("id IN ?", slices.Collect(maps.Keys(userIds))).Scan(&found).Error; err != nil {
			return err
		}
		for _, user := range found {
			users[user.Id] = user
		}
	}
	tokens := make(map[int]string, len(tokenIds))
	if len(tokenIds) > 0 {
		var found []struct {
			Id   int
			Name string
		}
		if err := db.Unscoped().Model(&Token{}).Select("id, name").Where("id IN ?", slices.Collect(maps.Keys(tokenIds))).Scan(&found).Error; err != nil {
			return err
		}
		for _, token := range found {
			tokens[token.Id] = token.Name
		}
	}
	channels := make(map[int]string, len(channelIds))
	if len(channelIds) > 0 {
		var found []struct {
			Id   int
			Name string
		}
		if err := db.Model(&Channel{}).Select("id, name").Where("id IN ?", slices.Collect(maps.Keys(channelIds))).Scan(&found).Error; err != nil {
			return err
		}
		for _, channel := range found {
			channels[channel.Id] = channel.Name
		}
	}
	for _, row := range rows {
		if user, ok := users[row.UserID]; ok {
			row.Username = user.Username
			row.DisplayName = user.DisplayName
			row.UserDeleted = user.DeletedAt.Valid
		}
		row.TokenName = tokens[row.TokenID]
		row.ChannelName = channels[row.ChannelID]
	}
	return nil
}
