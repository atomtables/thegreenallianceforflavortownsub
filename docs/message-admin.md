# Message Administration Interface

## Overview

The Message Administration Interface provides authorized administrators with tools to monitor messages, manage conduct reports, and oversee chat communications on the platform. Access requires **mentor role (3) or above** AND the **message_moderate** permission.

## Access Control

- **Required Role**: `mentor` (3), `coach` (4), or `administrator` (5)
- **Required Permission**: `message_moderate` (Permission enum value 11)
- **Unauthorized Access**: Returns HTTP 404 (not 403/401) to prevent revealing the existence of admin features

## Pages

The admin panel is accessible at `/messages/admin` and consists of three sections:

### 1. Conduct Issues

View and manage reported messages and configure content filters.

#### Reports Management
- View all user-submitted and auto-flagged reports
- Filter reports by status: `open`, `reviewed`, `resolved`, `dismissed` (defaults to open)
- Update report status with actions: Mark Reviewed, Resolve, Dismiss, Reopen
- Add admin comments/notes to reports
- View the reported message in chat context (surrounding messages shown in a modal)
- Each report shows the reported message content, author, reporter, reason, and timestamp

#### Bad Words Filter
- Toggle the bad words filter on/off (disabled by default)
- Includes reasonable defaults that administrators can extend
- Add/remove words from the filter list
- When enabled, messages containing flagged words are blocked before sending and editing
- Configuration stored in `src/lib/server/admin/badwords.json`
- Configuration does not autosave — administrators must click Save to apply changes

### 2. Message Viewing

Search, filter, export, and manage all messages across the platform.

#### Filters
- **Author**: Filter by specific user
- **Keyword Search**: Search message content
- **Chat ID**: Filter by specific chat
- **Date Range**: Filter by date from/to
- **Has Attachment**: Filter messages with attachments
- **Show Deleted**: Include soft-deleted messages
- **Sort**: Newest first or oldest first

#### Actions
- Messages are displayed in a table with checkboxes for selection
- **Export JSON/CSV/Plaintext**: Download messages (selected or all)
- **Mark Selected Deleted**: Soft-delete selected messages
- **Permanently Delete Selected**: Permanently remove selected messages from database
- **View Edit History**: Click "(edited)" label to view full edit history of a message
- **View in Chat Context**: View a message within its surrounding chat conversation
- Default actions (refresh, export) available when no messages are selected

### 3. Chat Monitoring

View all chats and their messages in read-only mode.

- Browse all chats (DMs and group chats)
- View participant lists and last messages
- Open any chat to view its full message history
- Recent messages shown first, scroll up to load older messages
- Read-only access — administrators cannot send, edit, or delete messages through this view

## API Endpoints

### Messages Admin

#### `GET /api/messages/admin`
List all messages with optional filters.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Results per page (default: 50, max: 100) |
| `author` | string | Filter by author user ID |
| `chatId` | string | Filter by chat ID |
| `keyword` | string | Search message content |
| `hasAttachment` | "true" | Filter messages with attachments |
| `showDeleted` | "true" | Include deleted messages |
| `dateFrom` | string | ISO date string, filter from date |
| `dateTo` | string | ISO date string, filter to date |
| `sort` | "asc"\|"desc" | Sort direction (default: desc) |

**Response:**
```json
{
    "messages": [...],
    "total": 150,
    "page": 1,
    "limit": 50
}
```

#### `DELETE /api/messages/admin`
Mass delete messages.

**Request Body:**
```json
{
    "messageIds": ["id1", "id2"],
    "permanent": false
}
```

- `permanent: false` — Soft-deletes (marks as deleted)
- `permanent: true` — Permanently removes from database

### Reports

#### `GET /api/messages/admin/reports`
List conduct reports.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status: open, reviewed, resolved, dismissed |
| `page` | number | Page number (default: 1) |
| `limit` | number | Results per page (default: 50) |

#### `POST /api/messages/admin/reports`
Create a new report (user-facing, does not require admin access).

**Request Body:**
```json
{
    "messageId": "message_snowflake_id",
    "reason": "Optional reason for the report"
}
```

#### `PATCH /api/messages/admin/reports`
Update report status or add admin notes (admin only).

**Request Body:**
```json
{
    "reportId": "report_snowflake_id",
    "status": "resolved",
    "adminNotes": "Reviewed and confirmed violation"
}
```

All fields except `reportId` are optional. Valid statuses: `open`, `reviewed`, `resolved`, `dismissed`

### Chats

#### `GET /api/messages/admin/chats`
List all chats for monitoring.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `chatId` | string | If provided, returns messages for that chat |
| `page` | number | Page number for messages (default: 1) |
| `limit` | number | Results per page for messages (default: 50) |

**Response (no chatId):**
```json
{
    "chats": [...],
    "users": { "userId": {...} }
}
```

**Response (with chatId):**
```json
{
    "messages": [...]
}
```

### Bad Words Configuration

#### `GET /api/messages/admin/badwords`
Get current bad words filter configuration.

**Response:**
```json
{
    "enabled": false,
    "words": ["word1", "word2"]
}
```

#### `PUT /api/messages/admin/badwords`
Update bad words filter configuration.

**Request Body:**
```json
{
    "enabled": true,
    "words": ["word1", "word2"]
}
```

### Terms of Service

#### `GET /api/users/tos`
Get current Terms of Service content and last updated date.

#### `POST /api/users/tos`
Accept the Terms of Service (sets `tosAgreedAt` for the authenticated user).

## Database Schema Additions

### `message_reports` Table
| Column | Type | Description |
|--------|------|-------------|
| `id` | varchar(21) | Snowflake ID (primary key) |
| `message_id` | varchar(21) | FK to messages |
| `message_author_id` | varchar(36) | FK to users |
| `reporter_id` | varchar(36) | FK to users (nullable for auto-reports) |
| `reason` | text | Report reason |
| `status` | text | open, reviewed, resolved, dismissed |
| `reported_at` | timestamp | When the report was created |
| `resolved_at` | timestamp | When the report was resolved |
| `resolved_by` | varchar(36) | FK to users (who resolved it) |
| `source` | text | "user" or "badword" |
| `admin_notes` | text | Admin comments/notes on the report |

### `users` Table Addition
| Column | Type | Description |
|--------|------|-------------|
| `tos_agreed_at` | timestamp | When the user last agreed to the TOS |

## Security Considerations

- All admin pages and API endpoints return 404 for unauthorized users
- Privacy warnings are displayed prominently on all message viewing and chat monitoring pages
- The Terms of Service requires explicit consent for message monitoring
- Users under 13 are not permitted to use the platform
- The bad words filter is disabled by default
- All message content is stored unencrypted as disclosed in the TOS

## File Structure

```
src/
├── lib/server/admin/
│   ├── access.ts          # Admin access permission helper
│   ├── badwords.ts        # Bad words check/config helpers
│   ├── badwords.json      # Bad words configuration (debug file)
│   └── tos.ts             # Terms of Service content and config
├── routes/
│   ├── (protected)/
│   │   ├── messages/admin/
│   │   │   ├── +page.server.ts    # Admin page server (access check)
│   │   │   └── +page.svelte       # Admin panel UI (3 tabs)
│   │   └── tos/
│   │       ├── +page.server.ts    # TOS page server
│   │       └── +page.svelte       # TOS agreement page
│   └── api/
│       ├── messages/admin/
│       │   ├── +server.ts         # Messages list/delete API
│       │   ├── reports/+server.ts # Reports CRUD API
│       │   ├── chats/+server.ts   # Chat monitoring API
│       │   └── badwords/+server.ts # Bad words config API
│       └── users/tos/+server.ts   # TOS agreement API
└── docs/
    └── message-admin.md           # This documentation
```
