# PR Review Template Guide

## Template structure

```
src/
├── templates/
│   ├── default/
│   │   └── prompt.md                       # Default template (built-in)
│   └── custom/
│       ├── [template-name].md              # Your custom templates
│       ├── performance-review.md           # Example: Performance review
│       ├── quick-review.md                 # Example: Quick review
│       └── security-focused.md             # Example: Security focused
└── config/
    └── template-config.json                # Repository → Template mapping
```

## Quick Start

### Step 1: Create your template

Create a new file following naming convention:

```bash
# Pattern: src/templates/custom/[template-name].md
touch src/templates/custom/api-review.md
```

**Naming convention:**

* Use lowercase with hyphens: `security-focused`, `api-review`, `quick-check`
* Avoid spaces or special characters
* Make names descriptive: ❌ `template1.md` ✅ `security-focused.md`
* Start with empty `repositories: {}` - all repos use `defaultTemplate`
Add repository mappings only when you want to use custom templates

### Step 2: Write template content

```markdown
**Role:**  
You are an API-focused code reviewer.

**Goal:**  
Review REST API changes for {{repository}}.

**PR:** `{{prUrl}}`

## Review Checklist
- Validate HTTP methods and status codes
- Check request/response schemas
- Review error handling

## Final Step: Output Metrics
```json
{
  "isLgtm": true/false,
  "issueCount": <number>
}
```

### Step 3: Configure repository mapping

Edit `src/config/template-config.json`

```json
{
   "defaultTemplate":"default",
   "repositories":{
      "backend-api":"api-review"
   }
}
```
**Configuration rules:**

* `defaultTemplate:` Template used when no repository mapping exists.
* `repositories`: Object mapping repository names to template names.
* Template names **must** match filename without `.md` extension.

### Step 4: Apply changes

```bash
# Restart to load new configuration
docker-compose restart pr-automation

# Verify logs
docker-compose logs -f pr-automation | grep -i template
```

## Template variables

| Variable | Type | Description | Example Value |
|----------|------|-------------|---------------|
| `{{prUrl}}` | String | Pull request URL | `https://bitbucket.org/workspace/repo/pull-requests/123` |
| `{{title}}` | String | PR title | `"Add user authentication endpoint"` |
| `{{description}}` | String | PR description | `"This PR implements JWT auth..."` |
| `{{author}}` | String | PR author username | `"john.doe"` |
| `{{sourceBranch}}` | String | Source branch name | `"feature/user-auth"` |
| `{{destinationBranch}}` | String | Target branch name | `"main"` |
| `{{repository}}` | String | Repository name | `"backend-api"` |

**Usage example:**

```markdown
## PR Information
- **Repository:** {{repository}}
- **Author:** {{author}}
- **Branch:** {{sourceBranch}} → {{destinationBranch}}
- **URL:** {{prUrl}}
```

Output after substitution:

```markdown
## PR Information
- **Repository:** backend-api
- **Author:** john.doe
- **Branch:** feature/user-auth → main
- **URL:** https://bitbucket.org/workspace/repo/pull-requests/123
```

## Template requirements

Every template **must** include these sections:

**1. Role Definition**

```markdown
**Role:**  
You are a [type] code reviewer with [capabilities].
```

**2. Goal Statement**

```markdown
**Goal:**  
[Clear objective of the review]
```

**3. PR Reference**

```markdown
**PR:**  
`{{prUrl}}`
```

**4. Metrics Output Format**

After posting the PR comment, you must output a JSON block:

```json
{
  "isLgtm": true/false,
  "issueCount": <number>
}
```
**Note:** These sections are validated automatically. Missing any will cause template validation to fail.

## Template examples

### Example 1: Security-Focused Review

**Filename:** [`src/templates/custom/security-focused.md`](./src/templates/custom/security-focused.md)

### Example 2: Performance-Focused Review

**Filename:** [`src/templates/custom/performance-review.md`](./src/templates/custom/perfomance-review.md)

### Example 3: Quick Review

**Filename:** [`src/templates/custom/quick-review.md`](./src/templates/custom/quick-review.md)


## Configuration reference

### Configuration file schema

**File:** `src/config/template-config.json`

```json
{
  "defaultTemplate": "string",
  "repositories": {
    "string": "string"
  }
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `defaultTemplate` | string | Yes | Template name for repositories without explicit mapping |
| `repositories` | object | No | Map of repository name → template name |

### Configuration Examples

**Example 1: Single Template for All**
```json
{
  "defaultTemplate": "default",
  "repositories": {}
}
```

**Example 2: Repository-Specific Templates**
```json
{
  "defaultTemplate": "default",
  "repositories": {
    "payment-api": "security-focused",
    "analytics-service": "performance-review",
    "ui-components": "quick-review"
  }
}
```

**Example 3: Mixed Strategy**
```json
{
  "defaultTemplate": "quick-review",
  "repositories": {
    "critical-service": "security-focused",
    "core-api": "default"
  }
}
```

## Template validation

Templates are validated automatically on load. Validation checks:

### Validation rules
| Rule | Severity | Description |
|------|----------|-------------|
| Non-empty content | ❌ Error | Template must contain text |
| Contains `Role:` | ❌ Error | Must define reviewer role |
| Contains `Goal:` | ❌ Error | Must state review objective |
| Contains `PR:` | ❌ Error | Must reference PR URL |
| Valid variable syntax | ❌ Error | No malformed `{{variables}}` |
| Uses recommended variables | ⚠️ Warning | Should use common variables |

### Validation output examples

**✅ Valid Template:**
```
Loading custom template: security-focused
Template validation passed
Variables found: {{prUrl}}, {{repository}}, {{author}}
```

**⚠️ Valid with Warnings:**
```
Loading custom template: quick-review
Template validation passed
Note: Template is missing recommended variables: description, sourceBranch
```

**❌ Invalid Template:**
```
Loading custom template: broken-template
Template validation failed:
Missing required section: Role:
Missing required section: Goal:
Malformed variable syntax: {{prUrl
```






