# Setup on Windows (VS Code + PowerShell + MySQL), step by step

Open the **dairy_app** folder in VS Code (the one that contains `app`, `database`, `wsgi.py`).
All commands below are typed in the VS Code terminal (PowerShell) from that folder.

## 1. Install the Python libraries
    python -m pip install -r requirements.txt

## 2. Install and configure MySQL (8.0 or 8.4)
During the MySQL Installer wizard: *Development Computer*, port **3306** (use 3307 if 3306 is taken), set a **root password**
and write it down, keep "Start at system startup" and the default Windows service. Skip sample databases.

Then tell PowerShell where `mysql.exe` is (adjust 8.4 to your version):

    $mysql = "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"

## 3. Create the database and tables (schema v2.2)
PowerShell does not support `<`, so use `source`:

    & $mysql -u root -p -e "source database/dairy_schema_v2.sql"
    & $mysql -u root -p -e "USE dairy_app; SHOW TABLES;"       # about 32 tables

> **Already created the database from the older v1 file (with real data in it)?** Do not run the new schema over it. Back up, then run all three upgrades:
>
>     & $mysql -u root -p -e "source database/upgrade/dairy_migrate_v1_to_v2.sql"
>     & $mysql -u root -p -e "source database/upgrade/dairy_migrate_v2_1_tab_sessions.sql"
>     & $mysql -u root -p -e "source database/upgrade/dairy_migrate_v2_2_buyer_sales.sql"
>
> Your data is kept.

> **Already using schema v2.0?** Back up first, then run both upgrades:
>
>     & $mysql -u root -p -e "source database/upgrade/dairy_migrate_v2_1_tab_sessions.sql"
>     & $mysql -u root -p -e "source database/upgrade/dairy_migrate_v2_2_buyer_sales.sql"
>
> Your data is kept.

> **Already using schema v2.1?** Back up first, then run the buyer-sales upgrade:
>
>     & $mysql -u root -p -e "source database/upgrade/dairy_migrate_v2_2_buyer_sales.sql"

## 4. Create the app's own MySQL login (the app never runs as root)
Open `database\dairy_db_user.sql`, replace `CHANGE_ME_strong_password` with a password you choose (letters and numbers), then:

    & $mysql -u root -p -e "source database/dairy_db_user.sql"

## 5. Tell the code about the database
    copy .env.example .env
Edit `.env` in VS Code (use the password from step 4):

    SECRET_KEY=any-long-random-text-you-make-up-1234567890
    DATABASE_URL=mysql+pymysql://dairy_user:YOUR_PASSWORD@localhost:3306/dairy_app?charset=utf8mb4

    python -m flask --app wsgi check-db
Expected: `Connected. Server version: 8.x` and `OK: every table used by the code exists.`

## 6. Start the app and create the owner account (no command needed)
    python -m flask --app wsgi run
Open **http://127.0.0.1:5000** (not Live Server). The very first time, you will see **"Welcome! Create the owner account"**:
enter your farm name, your name, a username and a password. After that this page disappears forever and the normal login appears.

## 7. Add your staff (in the app)
Sign in as the owner > **Users** tab > *Add a person*: full name, username, role (milker / shop attendant) and a **temporary password**.
Tell them the password; the app makes them choose their own the first time they sign in.
In the same tab you can **deactivate** someone who leaves, **reset a forgotten password**, or **unlock** an account that was locked
after 5 wrong passwords (it also unlocks by itself after 15 minutes).

## 8. Enter the stock you already have (once)
Owner > **Opening stock**: milk at the farm, and milk / yoghurt / maziwa mala at the shop, counted on a date before you start recording.

## 9. Where your data lives, and how to see it
Everything is saved in MySQL (database `dairy_app`). To look at it: open **MySQL Workbench** > connect as `root` > schema `dairy_app` >
right-click a table (`milk_production`, `sales`, `stock_movements`, `audit_logs` ...) > *Select Rows*.
Passwords are never stored as text, only as a hash. The owner's **Activity** tab shows who did what.

## 10. Backups (do this every day)
    python -m flask --app wsgi backup
This writes a file such as `backups\dairy_2026-11-10_180000.sql` with all your data (the newest 30 are kept).
**Copy the file to a flash drive or cloud storage too**, not only the same computer.
If `mysqldump` is not found, add `MYSQLDUMP_PATH=...` to `.env` (see `.env.example`).
Tip: Windows *Task Scheduler* can run the backup command every night.

**Restoring** (only if something goes wrong): rebuild an empty database from the schema, then load the backup:

    & $mysql -u root -p -e "DROP DATABASE IF EXISTS dairy_app"
    & $mysql -u root -p -e "source database/dairy_schema_v2.sql"
    & $mysql -u root -p dairy_app -e "source backups/dairy_2026-11-10_180000.sql"

## Other commands
| Command | What it does |
|---|---|
| `python -m flask --app wsgi list-users` | shows everyone (never passwords) |
| `python -m flask --app wsgi create-user` | adds a user from the terminal |
| `python -m flask --app wsgi reset-password` | emergency password reset (if the owner is locked out) |
| `python -m flask --app wsgi seed-demo` | development only: creates a demo business with owner1 / milker1 / attendant1 |
| `python -m pytest -q` | runs the 64 automatic tests |

## Common errors
| Message | Fix |
|---|---|
| `No module named flask` | step 1, and make sure you are inside `dairy_app` |
| `Access denied for user 'dairy_user'` | wrong password in `.env`, or step 4 not run |
| `Can't connect to MySQL server` | Windows key > Services > *MySQL80* or *MySQL84* > Start |
| `Unknown database 'dairy_app'` | step 3 not run |
| Login page says "Cannot reach the server" | you opened it through Live Server (5500); use port 5000 |
| `Table ... doesn't exist` / `Unknown column` | the database is from an older schema: run the migration in step 3's note |
| "This account is locked" | wait 15 minutes, or the owner clicks *Unlock* in Users |
