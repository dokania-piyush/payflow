# 🚀 PayFlow - Enterprise Payment Gateway Architecture

PayFlow is a full-stack, enterprise-grade **Payment Gateway & Ledger System** designed to handle high-volume B2B2C financial transactions safely and reliably. 

Built with modern architecture patterns used by companies like Stripe and Razorpay, PayFlow includes robust features like **Double-Entry Bookkeeping**, **Idempotent API Requests**, **Machine Learning Fraud Detection**, and **Asynchronous Webhooks**.

![PayFlow Banner](https://img.shields.io/badge/Status-Production%20Ready-success) ![License](https://img.shields.io/badge/License-MIT-blue)

---

## 🏗 Architecture Overview

PayFlow operates on a **B2B2C** (Business-to-Business-to-Consumer) model. 

1. **The Merchant (e.g., Zomato, Amazon):** Integrates the PayFlow REST API into their backend.
2. **The Customer:** Buys a product on the Merchant's website.
3. **PayFlow API:** The Merchant's server securely hits PayFlow's `POST /payments` endpoint to transfer funds from the Customer to the Merchant.
4. **The Ledger:** PayFlow uses strict **double-entry bookkeeping** (debits and credits) to ensure money is never created or destroyed out of thin air.
5. **Machine Learning:** Every transaction is synchronously analyzed by a Python microservice to detect anomalous/fraudulent patterns.
6. **Webhooks:** PayFlow asynchronously notifies the Merchant's server via Redis queues that the payment was successful.

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
* 🛡️ **Idempotent API:** Safe against network failures. If a merchant accidentally sends the same payment request twice, the Idempotency middleware intercepts it and returns the cached result, preventing double-charging.
* 🤖 **AI Fraud Detection:** A Python microservice assigns a risk score (0.0 to 1.0) to every transaction. High-risk transactions (>0.85) are automatically blocked or flagged for manual Admin review.
* 🎣 **Reliable Webhooks:** Failed webhook deliveries to merchants are pushed to a Redis Queue with an exponential backoff retry strategy.
* 👥 **Role-Based Access Control:** Separate JWT permissions for **Admins** (who manage the system and freeze accounts) and **Merchants** (who process payments).

---

## 🖥️ User Interfaces

PayFlow includes three distinct frontends to demonstrate the complete ecosystem:

1. **B2C Demo E-commerce Store (`/demo-store`)**
   - Simulates a real customer checkout experience on a merchant's website. Features a sleek PayFlow Checkout Widget overlay that processes live transactions.

2. **Merchant Dashboard (`/merchant`)**
   - The analytics hub for businesses. Displays Total Revenue, Transactions Today, Success/Failure rates, and interactive volume charts.

3. **Admin Control Center (`/admin`)**
   - The internal tool for PayFlow staff. Allows admins to monitor database/queue health, view global flagged transactions, and freeze/unfreeze malicious merchant accounts.

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

### 4. Access the App
Open **http://localhost:5173** in your browser.
- **Admin Login:** `admin@payflow.com` / `admin123`
- **Merchant Login:** `demo@acme.com` / `demo1234`

---

## 📂 Project Structure

```
payflow/
├── frontend/                 # React UI (Dashboards & B2C Demo)
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
