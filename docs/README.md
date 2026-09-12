# Provider Intelligence Platform

A Node.js/Express + PostgreSQL backend for US healthcare provider intelligence. It integrates CMS Quality Payment Program (QPP) data, CMS Care Compare hospital quality measures, and the NIH Clinical Tables NPI registry API.

## 1. Project Overview

The Provider Intelligence Platform lets users:

- **Search providers**: Look up individual clinicians and organizations by name, state, city, and taxonomy, backed by the NPI registry and local data.
- **View MIPS performance scores and trends**: Retrieve Merit-based Incentive Payment System (MIPS) final scores, category scores, and payment adjustments for a given NPI, including year-over-year trends.
- **View hospital quality measures**: Retrieve CMS Care Compare quality measures for a facility, with national comparisons and CMS footnote explanations.

## 2. Architecture

The backend follows a layered service pattern:

**Routes -> Controllers -> Services -> Repositories / External API Clients**

- **Express server**: HTTP routing, request validation, error handling middleware.
- **PostgreSQL 15 database**: Local persistence for providers, MIPS performance records, quality measures, and bulk import job state.
- **Service layer**: Business logic, combining repository data with live upstream API data.
- **Caching layer**: A simple in-process cache (node-cache or an equivalent Map-based TTL cache) sits in front of the government APIs. Caching and request coalescing (deduplicating concurrent identical in-flight requests) matter because the upstream APIs impose practical limits.

### Upstream API constraints that drive caching

| Upstream API | Constraints |
|---|---|
| CMS data-api (QPP Experience) | Paginated in 5000-row pages via `size`/`offset` |
| CMS provider-data datastore/query (Care Compare) | Datastore query endpoint per dataset |
| Clinical Tables NPI API (npi_idv / npi_org) | Advised soft rate limit of 25 req/s, `maxList` capped at 500, offset + count capped at 7500 |

### Architecture diagram

```
            +-----------+
            |  Clients  |
            +-----+-----+
                  |
                  v
        +-------------------+
        |  Express Routes   |
        +-------------------+
                  |
                  v
        +-------------------+
        |   Controllers     |
        +-------------------+
                  |
                  v
        +-------------------+
        |     Services      |
        +----+---------+----+
             |         |
             v         v
   +-------------+  +-------------------+
   | Repositories|  | External API      |
   | (PostgreSQL)|  | Clients + Cache   |
   +------+------+  +---------+---------+
          |                   |
          v                   v
   +-------------+  +---------------------------+
   | PostgreSQL  |  | CMS QPP API / Care Compare|
   | 15          |  | NIH Clinical Tables NPI   |
   +-------------+  +---------------------------+
```

## 3. Prerequisites and Windows Setup

### Prerequisites

- Node.js 22 LTS
- PostgreSQL 15

### Setup steps

1. Install Node.js 22 LTS and PostgreSQL 15. On Windows, use the official installers and ensure `psql` is on your PATH (for example, `C:\Program Files\PostgreSQL\15\bin`).

2. Clone the repository:

   ```bash
   git clone https://github.com/your-org/provider-intelligence-platform.git
   cd provider-intelligence-platform
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Create the database:

   ```bash
   createdb -U postgres provider_intel
   ```

   or:

   ```bash
   psql -U postgres -c "CREATE DATABASE provider_intel;"
   ```

5. Run the schema initialization script:

   ```bash
   psql -U postgres -d provider_intel -f src/config/init.sql
   ```

6. Copy `.env.example` to `.env` and set the variables:

   ```
   DATABASE_URL=postgres://postgres:password@localhost:5432/provider_intel
   PORT=3000
   CMS_QPP_API_BASE_URL=https://data.cms.gov/data-api/v1/dataset/7adb8b1b-b85c-4ed3-b314-064776e50180/data
   CMS_PROVIDER_DATA_BASE_URL=https://data.cms.gov/provider-data/api/1/datastore/query
   NPI_API_BASE_URL=https://clinicaltables.nlm.nih.gov/api
   CACHE_TTL=3600
   ```

### npm scripts

| Script | Command | Description |
|---|---|---|
| dev | `npm run dev` | Start the server with hot reload |
| start | `npm start` | Start the production server |
| test | `npm test` | Run the test suite |
| lint | `npm run lint` | Run ESLint |

## 4. API Reference

Example requests and responses are shown below. Exact response shapes should be confirmed against the running backend, as fields may evolve.

### Search providers

```
GET /providers/search?query=smith&state=MD&city=&taxonomy=&page=1&limit=20
```

Response:

```json
{
  "page": 1,
  "limit": 20,
  "total": 137,
  "results": [
    {
      "npi": "1234567890",
      "name": "Smith, John A MD",
      "entityType": "individual",
      "taxonomy": "Internal Medicine",
      "city": "Baltimore",
      "state": "MD"
    }
  ]
}
```

### Get provider by NPI

```
GET /providers/1234567890
```

Response:

```json
{
  "npi": "1234567890",
  "entityType": "individual",
  "firstName": "John",
  "lastName": "Smith",
  "credential": "MD",
  "taxonomy": "Internal Medicine",
  "address": {
    "line1": "100 Main St",
    "city": "Baltimore",
    "state": "MD",
    "postalCode": "21201"
  }
}
```

### Get MIPS performance (latest year)

```
GET /providers/1234567890/mips-performance
```

Response:

```json
{
  "npi": "1234567890",
  "year": 2023,
  "finalScore": 82.45,
  "qualityCategoryScore": 78.1,
  "piCategoryScore": 90.0,
  "iaCategoryScore": 40.0,
  "costCategoryScore": 61.3,
  "paymentAdjustmentPercentage": 1.82,
  "participation": {
    "participationType": "individual",
    "isOptedIn": false,
    "smallPractice": false,
    "rural": false
  }
}
```

### Get MIPS trends

```
GET /providers/1234567890/mips-trends
```

Response:

```json
{
  "npi": "1234567890",
  "trends": [
    {
      "year": 2021,
      "finalScore": 74.2,
      "paymentAdjustmentPercentage": 0.9
    },
    {
      "year": 2022,
      "finalScore": 79.6,
      "paymentAdjustmentPercentage": 1.4
    },
    {
      "year": 2023,
      "finalScore": 82.45,
      "paymentAdjustmentPercentage": 1.82
    }
  ]
}
```

### Get quality measures for a facility

```
GET /quality-measures/210001
```

Response:

```json
{
  "facilityId": "210001",
  "measures": [
    {
      "measureId": "MORT_30_AMI",
      "measureName": "Death rate for heart attack patients",
      "score": "12.4",
      "comparedToNational": "No different than the national rate",
      "footnote": null,
      "startDate": "07/01/2020",
      "endDate": "06/30/2023"
    },
    {
      "measureId": "HAI_1_SIR",
      "measureName": "Central line-associated bloodstream infections (CLABSI) in ICUs and select wards",
      "score": null,
      "comparedToNational": null,
      "footnote": "1",
      "startDate": "01/01/2023",
      "endDate": "12/31/2023"
    }
  ]
}
```

Footnote codes follow the CMS Footnote Crosswalk. For example, footnote `1` means the number of cases or patients is too few to report. Consult the current CMS crosswalk for the full list of codes.

### Trigger a bulk data import

```
POST /providers/bulk-data
Content-Type: application/json

{
  "source": "qpp_experience",
  "year": 2023,
  "state": "MD"
}
```

Response (async job):

```json
{
  "jobId": "job_8f3c2a1d",
  "status": "queued",
  "source": "qpp_experience",
  "year": 2023,
  "state": "MD",
  "createdAt": "2024-06-01T12:00:00.000Z"
}
```

## 5. Data Sources

| Source | URL | Notes |
|---|---|---|
| CMS QPP Experience (data-api) | `https://data.cms.gov/data-api/v1/dataset/7adb8b1b-b85c-4ed3-b314-064776e50180/data` | Column names are lowercase with spaces. Paginate with `size` and `offset`, maximum page size 5000 rows. |
| CMS Care Compare (provider-data) | `https://data.cms.gov/provider-data/api/1/datastore/query/{dataset-id}/0` | Example dataset IDs: `ynj2-r877` (Complications and Deaths), `632h-zaca` (Unplanned Hospital Visits), `77hc-ibv8` (Healthcare-Associated Infections), `dgck-syfz` (HCAHPS). |
| NIH Clinical Tables NPI API | `https://clinicaltables.nlm.nih.gov/api/npi_idv/v3/search` and `https://clinicaltables.nlm.nih.gov/api/npi_org/v3/search` | Free, no API key. Advised soft rate limit of 25 requests per second, `maxList` maximum 500, offset + count capped at 7500. |

## 6. Roadmap

- **Analytics module**: Aggregations and benchmarking across providers, facilities, and measures.
- **React frontend**: In progress, see FRONTEND_SPEC.md.
- **Docker support**: Dockerfile and docker-compose setup with a PostgreSQL service.

## 7. License

MIT
