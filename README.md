# Cursor Usage Metrics Dashboard

A Node.js + Express web application for analyzing, visualizing, and reporting on usage metrics and sensitive data from Cursor logs. The dashboard provides interactive charts, tables, and reports for system activity, sensitive data findings, performance metrics, and more.

---

## Features

- **User Authentication:** Secure login system.
- **Dashboard:** Modern, responsive dashboard with:
  - Performance Metrics (summary and chart)
  - Sensitive Data Report (chart and detailed list)
  - Section Record Distribution, Languages Used, and more
- **Sensitive Data Scanning:** Scans logs for sensitive keywords and displays findings.
- **DataTables Integration:** All tables use DataTables for search, filter, and pagination.
- **Date Range Filtering:** Analyze logs for any custom date range.
- **API Endpoints:** JSON APIs for metrics and log data.
- **Modular Codebase:** Clean separation of controllers, routes, views, and public assets.

---

## Project Structure

```
cursorpoc/
  controllers/         # Backend logic (log processing, metrics, login)
  routes/              # Express route definitions (API and web)
  views/               # EJS templates for all dashboard pages
  public/              # Static assets (JS, CSS, images)
  cursorlogs/          # Log files to be analyzed
  index.js             # Main Express app entry point
  package.json         # Project metadata and dependencies
```

---

## Installation

1. **Clone the repository:**
   ```sh
   git clone <your-repo-url>
   cd cursorpoc
   ```

2. **Install dependencies:**
   ```sh
   npm install
   ```

3. **Prepare log files:**
   - Place your Cursor log `.json` files in the `cursorlogs/` directory.

4. **(Optional) Configure environment variables:**
   - You can set `SQLITE_FOLDER_PATH` or other environment variables as needed.

---

## Running the Application

1. **Start the server:**
   ```sh
   node index.js
   ```
   By default, the app runs on [http://localhost:3000](http://localhost:3000).

2. **Access the dashboard:**
   - Open your browser and go to [http://localhost:3000/login](http://localhost:3000/login) to log in.
   - After login, you'll be redirected to the dashboard.

3. **Usage Metrics:**
   - Visit `/usage-metrics` or use the dashboard to select a date range and view metrics.

---

## API Endpoints

- `GET /api/metrics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`  
  Returns all usage metrics and sensitive data for the specified date range.

- `GET /usage-metrics/data?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`  
  Returns optimized JSON for the dashboard.

- Additional endpoints for prompts, generations, files, etc.

---

## Customization

- **Add new sensitive keywords:**  
  Edit the `SENSITIVE_KEYWORDS` array in `controllers/logProcessor.js`.

- **Change dashboard layout or add new charts:**  
  Edit the EJS templates in `views/` and the JS in `public/js/dashboard.js`.

---

## Development Notes

- All tables use DataTables for pagination and search.
- Only the top 10 records are shown in summary tables, with a "View All" button for full lists.
- The backend is modular and can be extended for new metrics or log formats.

---

## License

MIT (or your chosen license) 