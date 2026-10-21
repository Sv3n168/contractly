"""Runtime configuration, read from environment variables."""

import os
from pathlib import Path


class Settings:
    def __init__(self) -> None:
        self.data_dir = Path(os.environ.get("CONTRACTLY_DATA_DIR", "/data"))
        self.documents_dir = self.data_dir / "documents"
        self.static_dir = Path(
            os.environ.get(
                "CONTRACTLY_STATIC_DIR",
                Path(__file__).resolve().parent.parent.parent / "frontend",
            )
        )
        # Login sessions (the encryption key itself stays in memory until restart or "lock").
        self.session_hours = float(os.environ.get("CONTRACTLY_SESSION_HOURS", "12"))
        self.session_days_remember = float(os.environ.get("CONTRACTLY_SESSION_DAYS_REMEMBER", "30"))
        self.max_upload_mb = int(os.environ.get("CONTRACTLY_MAX_UPLOAD_MB", "25"))
        # Notifications (all optional)
        self.public_url = os.environ.get("CONTRACTLY_PUBLIC_URL", "").rstrip("/")
        self.notify_interval_min = int(os.environ.get("CONTRACTLY_NOTIFY_INTERVAL_MIN", "60"))
        self.ntfy_url = os.environ.get("CONTRACTLY_NTFY_URL", "")
        self.ntfy_token = os.environ.get("CONTRACTLY_NTFY_TOKEN", "")
        self.smtp_host = os.environ.get("CONTRACTLY_SMTP_HOST", "")
        self.smtp_port = int(os.environ.get("CONTRACTLY_SMTP_PORT", "587"))
        self.smtp_user = os.environ.get("CONTRACTLY_SMTP_USER", "")
        self.smtp_password = os.environ.get("CONTRACTLY_SMTP_PASSWORD", "")
        self.smtp_from = os.environ.get("CONTRACTLY_SMTP_FROM", self.smtp_user)
        self.smtp_to = os.environ.get("CONTRACTLY_SMTP_TO", "")
        # "starttls" (default), "ssl" or "none"
        self.smtp_security = os.environ.get("CONTRACTLY_SMTP_SECURITY", "starttls").lower()

        # Backups
        self.backup_dir = Path(os.environ.get("CONTRACTLY_BACKUP_DIR", self.data_dir / "backups"))
        # "off", "daily" or "weekly"
        self.backup_schedule = os.environ.get("CONTRACTLY_BACKUP_SCHEDULE", "off").lower()
        self.backup_keep = int(os.environ.get("CONTRACTLY_BACKUP_KEEP", "10"))
        # Passphrase for automatic backups; manual backups ask for a key in the UI.
        self.backup_passphrase = os.environ.get("CONTRACTLY_BACKUP_PASSPHRASE", "")
        # rclone remote, e.g. "onedrive:Backups/Contractly" or "gdrive:Contractly"
        self.backup_remote = os.environ.get("CONTRACTLY_BACKUP_REMOTE", "")

    @property
    def db_path(self) -> Path:
        return self.data_dir / "contractly.db"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.backup_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
