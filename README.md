# 🚀 PayFlow - Internal Settlement & Payout Architecture

PayFlow is a full-stack **internal settlement and payout prototype** for marketplace-style organizations that pay riders, vendors, and partners safely and reliably.

Built with modern architecture patterns used by companies like Stripe and Razorpay, PayFlow includes robust features like **Double-Entry Bookkeeping**, **Idempotent API Requests**, **Machine Learning Fraud Detection**, and **Asynchronous Webhooks**.

![PayFlow Banner](https://img.shields.io/badge/Status-Production%20Ready-success) ![License](https://img.shields.io/badge/License-MIT-blue)

---

## 🏗 Architecture Overview

PayFlow operates as an internal finance layer after an organization has decided a payout is due. It is not a replacement for Razorpay, Stripe, or bank payment rails.

- **Organization:** A marketplace or delivery platform integrates the API and owns a funded settlement account.
- **Beneficiary:** A rider, vendor, or partner receives payouts in an organization-owned virtual wallet.
- **Complete Flow:** The finance team creates a daily payout batch, then PayFlow transfers money from the organization settlement account to selected beneficiaries.
- **Ledger:** Every completed payout creates a matching debit and credit entry for auditability.
- **Risk review:** High-value payouts are held for an admin rather than immediately moving funds.
- **Notifications:** Webhooks are queued after the payout commit, with retries when a recipient endpoint is unavailable.

---

## 💻 Tech Stack

### Frontend (Dashboards & UI)
- **React 19 & Vite:** Lightning-fast frontend tooling.
- **Tailwind CSS v4:** Modern, utility-first styling.
- **Recharts:** Dynamic data visualization for revenue metrics.
- **Lucide React:** Clean, professional iconography.

### Backend (Core Engine)
- **Node.js & Express:** High-performance REST API.
- **PostgreSQL (Neon):** ACID-compliant relational database for absolute data integrity.
- **Redis:** In-memory data store for Webhook Job Queues and Rate Limiting.
- **JSON Web Tokens (JWT):** Secure Role-Based Access Control (RBAC).

### Microservices
- **Python & Flask:** Dedicated ML service for real-time transaction risk scoring (Fraud Detection).

---

## ✨ Key Enterprise Features

* 🏦 **Double-Entry Ledger Bookkeeping:** Every transaction creates a synchronized debit and credit entry. An automated reconciliation worker runs in the background to audit the database for discrepancies.
* 🛡️ **Idempotent Payout API:** Safe against network failures. If an organization retries the same payout request, the Idempotency middleware returns the prior result rather than creating a duplicate payout.
* 🤖 **AI Fraud Detection:** A Python microservice assigns a risk score (0.0 to 1.0) to every transaction. High-risk transactions (>0.85) are automatically blocked or flagged for manual Admin review.
* 🎣 **Reliable Webhooks:** Failed payout notifications are pushed to a Redis Queue with exponential backoff and can be replayed from dead-lettered delivery records.
* 👥 **Role-Based Access Control:** Separate JWT permissions for **Admins** (who manage the system and freeze accounts) and **Merchants** (who process payments).

---

## 🖥️ User Interfaces

PayFlow includes three distinct frontends to demonstrate the complete ecosystem:

1. **Settlement Operations Console (`/merchant`)**
   - Shows payout volume, processing results, and risk exceptions.

2. **Payout Batch Desk (`/settlements`)**
   - Creates rider/vendor beneficiaries, groups amounts due into a batch, and processes that batch from the organization settlement account.

3. **Admin Control Center (`/admin`)**
   - The internal tool for PayFlow staff. Allows admins to monitor database/queue health and approve/reject held payouts.

---

## 🛠️ How to Run Locally

### Prerequisites
- Docker & Docker Compose
- Node.js (v20+)

### 1. Start the Backend Infrastructure
The backend relies on Docker to spin up the Node API, Python ML Service, and Redis.
```bash
docker-compose up -d --build
```
*(Note: Ensure your `DATABASE_URL` is set in your `.env` file pointing to your PostgreSQL instance).*

### 2. Seed the Database
Run the seed script to create the default Admin and Merchant accounts.
```bash
npm run seed
```

### 3. Start the React Frontend
```bash
cd frontend
npm install
npm run dev
```

The production Docker image builds this React interface and serves it from the
same origin as the API. During local Vite development it calls the API on port
`3000`.

### 4. Access the App
Open **http://localhost:5173** in your browser.
- **Admin Login:** `admin@payflow.com` / `admin123`
- **Merchant Login:** `demo@acme.com` / `demo1234`

---

## 📂 Project Structure

```
payflow/
├── frontend/                 # React settlement dashboard and payout-batch desk
├── ml-service/               # Python Flask Fraud Detection Microservice
├── src/
│   ├── config/               # Database and environment configurations
│   ├── middleware/           # Auth, Idempotency, and Error Handling
│   ├── routes/               # Express API endpoints
│   ├── services/             # Core business logic (Payments, Ledger)
│   ├── utils/                # Logging and helper functions
│   └── workers/              # Redis Webhook and Reconciliation workers
├── schema.sql                # PostgreSQL Database Schema
└── docker-compose.yml        # Infrastructure orchestration
```

---

*Designed & Engineered as a robust demonstration of FinTech architecture.*
