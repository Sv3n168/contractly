# Contractly

**Alle laufenden Verträge im Blick: Kosten, Fristen, Preisverläufe und Wechsel.**

Contractly ist eine selbst gehostete Web-App (Docker) zur Verwaltung der eigenen Verträge:
Handy, Internet, Strom, Gas, Kfz-Versicherung, Rechtsschutz, Fitnessstudio, Streaming und alles andere,
was regelmäßig Geld kostet. Contractly ist kein Vergleichsportal. Es verwaltet nur deine eigenen
Verträge, und alle Daten bleiben auf deinem Server.

## Funktionen

| Bereich | Was du bekommst |
|---|---|
| **Dashboard** | Fixkosten pro Monat und Jahr, Veränderung zum Vorjahr, Kostenverlauf nach Bereichen (mit Vorschau), anstehende Fristen, größte Posten, Preisänderungen und die Ersparnis durch Wechsel |
| **Verträge** | Karten mit Preis, Eckdaten (z. B. „40 GB · 5G · Telekom“) und Fristhinweis. Filter nach Kategorie, Suche, Sortierung |
| **Vertrag anlegen** | Kategorie-Kachel antippen, Anbieter, Preis und Beginn eintragen, fertig. Laufzeiten und Kündigungsfristen sind je Kategorie vorbelegt. **Oder: Vertrag hochladen**, dann füllt die Texterkennung (OCR) die Felder aus |
| **Eckdaten je Kategorie** | Mobilfunk (Datenvolumen, Netz, 5G …), Internet (Mbit/s, Technik), Strom/Gas (Grundpreis, Arbeitspreis, Verbrauch, Abschlag, Zähler), Kfz (SF-Klassen, SB, Kennzeichen), Rechtsschutz, Haftpflicht, Hausrat, Fitness, Streaming … |
| **Preisverlauf** | Preishistorie mit Datum, beliebige Zahlweise (monatlich bis jährlich), Einmalzahlungen und Boni |
| **Zusatzkosten** | Teurere Einzelmonate (z. B. Auslandstelefonate, Roaming, Extra-Datenvolumen) als Mehrbetrag oder einfach als Rechnungsbetrag erfassen. Der Grundpreis bleibt, im Folgemonat gilt automatisch wieder der Basispreis. Im Plot als Punkte markiert, in der Hochrechnung optional als Ø der letzten 12 Monate |
| **Vergleichsmodul** | Angebote schnell eintragen. Contractly rechnet Einmalkosten, Boni, Aktionspreise und Laufzeit über 12/24/36 Monate gegen deinen Vertrag und sagt dir „Wechsel lohnt sich“, „geringe Ersparnis“ oder „lohnt nicht“. Dazu kommt ein Leistungsvergleich (z. B. 40 GB vs. 50 GB) |
| **Wechselboni** | Mehrere Boni je Angebot (Wechsel-, Neukunden-, Sofortbonus, Rufnummernmitnahme, Cashback) mit Auszahlungsmonat. Boni zählen nur, wenn sie im Vergleichszeitraum ausgezahlt werden. Umschalter „Mit/Ohne Boni“, Warnung „lohnt sich nur durch Bonus“ und Angabe, nach wie vielen Monaten der Vorteil aufgebraucht ist. Beim Wechsel werden Boni als Gutschrift im Auszahlungsmonat eingetragen, inklusive Erinnerung zur Kontrolle |
| **Wechsel** | Ein Klick beendet den alten Vertrag und legt den Nachfolger an. **Der Kostenplot läuft durchgehend weiter** (z. B. Fitnessstudio 35 € → Sportnavi 45 €). Das geht auch ohne Vergleichsmodul über „Durch neuen Vertrag ersetzen“ |
| **Zeitstrahl** | Gantt-Ansicht: Vertragsbeginn, Wechsel (in derselben Zeile), Kündigungsfristen, heute. Dazu eine Chronik |
| **Kosten & Prognose** | Historie nach Bereich oder Vertrag. Hochrechnung bis 10 Jahre mit einstellbarer Preissteigerung, Summen pro Jahr und Vertrag |
| **Fristen** | Nächstes Laufzeitende und letzter Kündigungstag werden automatisch berechnet. „Monatlich kündbar“ wird erkannt und nicht als Alarm angezeigt |
| **Erinnerungen** | Automatisch vor jeder Kündigungsfrist (Vorlauf je Vertrag einstellbar), eigene Erinnerungen (auch wiederkehrend). Zustellung im Dashboard, als **Kalender-Abo (iCal)**, per **Push (ntfy)** oder **E-Mail** |
| **Kündigungsschreiben** | Fertiger Brief mit deinen Absenderdaten, Anbieter-Adresse und Kunden-, Vertrags-, Zähler- oder Rufnummer. Ordentlich oder Sonderkündigung, optional mit Rufnummernmitnahme und SEPA-Widerruf. Drucken/PDF, Kopieren, E-Mail |
| **Dokumente & OCR** | PDFs und Fotos je Vertrag ablegen. „Erkennen“ liest Kundennummer, Vertragsnummer, Anbieter-Adresse, Preise, Zählernummer, MaLo, IBAN, Vertragsbeginn usw. aus und schlägt sie zur Übernahme vor |
| **Strom & Gas** | Zählerstände erfassen, daraus Verbrauch hochrechnen, Jahresabrechnung schätzen (Nachzahlung oder Guthaben) und einen passenden Abschlag vorschlagen |
| **Backup** | Vollbackup (Datenbank und Dokumente), optional **AES-256-verschlüsselt mit eigenem Schlüssel**. Automatisch täglich oder wöchentlich, Upload in **OneDrive, Google Drive, Dropbox, Nextcloud, S3 …** (über rclone), Wiederherstellung in der Oberfläche |
| **Sicherheit** | Anmeldeseite mit eigenem Konto. **Datenbank, Dokumente (PDFs, Fotos) und Backups sind verschlüsselt gespeichert** (SQLCipher/AES-256). Der Schlüssel entsteht aus dem Passwort und liegt nur während der Anmeldung im Arbeitsspeicher. Nach dem Abmelden ist nichts mehr lesbar. Dazu Wiederherstellungsschlüssel, Schutz vor Passwort-Raten und Sicherheits-Header |
| **Mehrere Benutzer** | Jede Person hat einen **eigenen, getrennt verschlüsselten Bereich**. Der Admin lädt per Einladungscode ein; das Passwort legt die Person selbst fest, daher kann auch der Admin keine fremden Verträge lesen |
| **Komfort** | Responsive für Desktop (Seitenleiste), Tablet (Icon-Leiste) und Smartphone (Navigation unten). Hell/Dunkel, Schnellsuche (Strg+K), als App installierbar (PWA), Demo-Daten zum Ausprobieren |

## Schnellstart

```bash
git clone https://github.com/sv3n168/contractly.git
cd contractly
docker compose up -d --build
```

Danach <http://localhost:8000> öffnen. Bei leerer Datenbank kannst du mit einem Klick Demo-Daten laden.

Alle Daten (Datenbank, Dokumente, Backups) liegen im Ordner `./data`.

## Erste Schritte & Sicherheit

1. Beim ersten Aufruf legst du das **Administrator-Konto** an. Danach wird dir ein
   **Wiederherstellungsschlüssel** angezeigt: gut aufbewahren! Ohne Passwort *und* ohne diesen
   Schlüssel sind die Daten nicht wiederherstellbar, auch nicht vom Admin.
2. Weitere Personen lädst du unter *Einstellungen → Benutzer* ein. Sie erhalten einen
   Einladungscode (7 Tage gültig), wählen „Einladungscode einlösen“ und legen ihr eigenes Passwort fest.
3. Jede Person sieht nur ihre eigenen Verträge. Der Admin verwaltet Benutzer und Backups.

**So funktioniert die Verschlüsselung**

- Jede Person hat einen zufälligen Datenschlüssel. Damit sind ihre SQLCipher-Datenbank und alle
  hochgeladenen Dateien verschlüsselt (AES-256). Gespeichert wird der Datenschlüssel nur
  verschlüsselt: einmal mit dem Passwort (scrypt), einmal mit dem Wiederherstellungsschlüssel.
- Nach der Anmeldung liegt der Schlüssel nur im Arbeitsspeicher des Servers. **Abmelden** (bzw.
  Ablauf der Sitzung oder ein Neustart des Containers) löscht ihn. Ab dann sind Datenbank und PDFs
  auch für den Server unlesbar.
- PDFs werden beim Ansehen im Arbeitsspeicher entschlüsselt. Für die Texterkennung entsteht kurz eine
  Kopie in `/dev/shm` (RAM), die danach sofort gelöscht wird.
- Damit **Erinnerungen und der Kalender** auch im abgemeldeten Zustand funktionieren, merkt sich
  Contractly pro Person die anstehenden Termine mit neutraler Bezeichnung (z. B. „Kündigungsfrist
  Mobilfunk-Vertrag“). Vertragsnamen erscheinen dort nur, wenn man das in den Einstellungen einschaltet.
- **Wichtig:** Betreibe Contractly außerhalb des Heimnetzes nur hinter HTTPS (z. B. Reverse Proxy
  mit Let's Encrypt), damit Passwörter verschlüsselt übertragen werden.

**Update von einer Version ohne Verschlüsselung:** Beim Einrichten des Admin-Kontos werden die
vorhandenen Daten aus `./data` in den Bereich des Admins übernommen, verschlüsselt, und die
unverschlüsselten Originale werden gelöscht. Die frühere Variable `CONTRACTLY_PASSWORD` wird nicht
mehr verwendet.

## Konfiguration

Alle Einstellungen werden über Umgebungsvariablen gesetzt (siehe `docker-compose.yml`).

| Variable | Standard | Bedeutung |
|---|---|---|
| `CONTRACTLY_SESSION_HOURS` | `12` | Automatische Abmeldung nach so vielen Stunden Inaktivität |
| `CONTRACTLY_SESSION_DAYS_REMEMBER` | `30` | Sitzungsdauer bei „Angemeldet bleiben“ |
| `CONTRACTLY_PUBLIC_URL` | – | Externe URL, wird für Links in Benachrichtigungen verwendet |
| `CONTRACTLY_MAX_UPLOAD_MB` | `25` | Maximale Dateigröße für Dokumente |
| `PUID` / `PGID` | `1000` | Benutzer- und Gruppen-ID, der die Dateien in `./data` gehören |
| `TZ` | `Europe/Berlin` | Zeitzone |

### Erinnerungen per Push oder E-Mail

Jede Person trägt unter *Einstellungen → Benachrichtigungen* ihre E-Mail-Adresse und/oder ihr
ntfy-Thema ein. Erinnerungen kommen auch dann an, wenn man gerade abgemeldet ist. Die folgenden
Variablen konfigurieren den Server und gelten für den Admin zusätzlich als Vorgabe.

**ntfy** (Push aufs Handy, z. B. mit der ntfy-App):

```yaml
CONTRACTLY_NTFY_URL: https://ntfy.sh/mein-langes-geheimes-topic
CONTRACTLY_NTFY_TOKEN: tk_...        # optional, bei geschütztem eigenem ntfy-Server
```

**E-Mail (SMTP):**

```yaml
CONTRACTLY_SMTP_HOST: smtp.example.org
CONTRACTLY_SMTP_PORT: "587"
CONTRACTLY_SMTP_SECURITY: starttls   # starttls | ssl | none
CONTRACTLY_SMTP_USER: me@example.org
CONTRACTLY_SMTP_PASSWORD: secret
CONTRACTLY_SMTP_TO: me@example.org
```

Der Container prüft stündlich (`CONTRACTLY_NOTIFY_INTERVAL_MIN`), ob etwas fällig ist, und meldet jede
Erinnerung genau einmal. Unter *Erinnerungen* gibt es einen Button für eine Testnachricht.

**Kalender:** Unter *Erinnerungen* findet jede Person einen persönlichen, geheimen Kalender-Link
(`…/api/calendar/<token>.ics`). Er lässt sich in iOS, Android/Google oder Outlook abonnieren und bei
Bedarf neu erzeugen; der alte Link ist dann ungültig.

### Backups und Cloud (OneDrive, Google Drive …)

Backups erstellt der Admin. Ein Backup enthält alle Benutzer mit ihren Datenbanken und Dokumenten,
und zwar **weiterhin mit den Schlüsseln der Benutzer verschlüsselt**. Der Admin kann damit also
nichts lesen. Nach einer Wiederherstellung meldet sich jede Person mit dem Passwort an, das zum
Zeitpunkt des Backups galt. Optional lässt sich das Backup zusätzlich mit einem Backup-Schlüssel
verschlüsseln (AES-256-GCM, Endung `.ctly`); das schützt auch die Benutzerliste. Automatische
Backups laufen auch, wenn niemand angemeldet ist.

```yaml
CONTRACTLY_BACKUP_SCHEDULE: daily          # off | daily | weekly
CONTRACTLY_BACKUP_KEEP: "14"               # Anzahl automatischer Backups, die behalten werden
CONTRACTLY_BACKUP_PASSPHRASE: langer-geheimer-schluessel   # verschlüsselt automatische Backups
CONTRACTLY_BACKUP_REMOTE: onedrive:Backups/Contractly      # rclone-Ziel (optional)
```

Für den Cloud-Upload ist [rclone](https://rclone.org) im Image enthalten. Damit gehen OneDrive, Google
Drive, Dropbox, Nextcloud/WebDAV, S3 und viele weitere. So richtest du ein Ziel ein:

```bash
# 1. Remote interaktiv einrichten (Konfiguration landet in ./data/rclone/rclone.conf;
#    -u = PUID, damit die App die Datei lesen darf)
docker compose exec -u 1000 -it contractly rclone config
#    -> "n" (new remote), Name z. B. "onedrive", Typ "onedrive" bzw. "drive" für Google Drive.
#    Bei "Use web browser to automatically authenticate?" mit "n" antworten und den angezeigten
#    Befehl `rclone authorize "onedrive"` auf einem Rechner mit Browser ausführen
#    (rclone dort installieren), dann den Token zurück ins Terminal kopieren.

# 2. Testen
docker compose exec -u 1000 contractly rclone lsd onedrive:

# 3. In docker-compose.yml setzen und neu starten
#    CONTRACTLY_BACKUP_REMOTE: onedrive:Backups/Contractly
docker compose up -d
```

Backups lassen sich auch manuell erstellen, herunterladen, in die Cloud laden und wiederherstellen
(*Einstellungen → Datensicherung*). Vor jeder Wiederherstellung legt Contractly automatisch ein
Sicherheits-Backup des aktuellen Stands an.

## Entwicklung

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
CONTRACTLY_DATA_DIR=../data uvicorn app.main:app --reload   # http://localhost:8000
python -m pytest
```

Für OCR werden lokal `tesseract-ocr`, `tesseract-ocr-deu` und `poppler-utils` benötigt.

**Aufbau**

- `backend/app`: FastAPI, SQLAlchemy mit SQLCipher (verschlüsseltes SQLite, je Benutzer eine Datei
  unter `data/users/<id>/`). Benutzer, Sitzungen und Schlüssel stehen in `security.py`. Berechnungen für Kosten, Fristen und Vergleiche stehen in `calc.py`, Erinnerungen in `reminders.py`, Backups in `backup.py`, die Texterkennung in `ocr.py`.
- `frontend/`: Single-Page-App ohne Build-Schritt (ES-Module, Chart.js mitgeliefert, funktioniert offline).
- REST-API mit interaktiver Doku unter `/docs`.

## Lizenz

Chart.js steht unter der MIT-Lizenz (`frontend/vendor/chart.js.LICENSE.md`).
