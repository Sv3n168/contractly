# Contractly

**Alle laufenden Verträge im Blick: Kosten, Fristen, Preisverläufe und Wechsel.**

Contractly ist eine selbst gehostete Web-App (Docker) zur Verwaltung der eigenen Verträge:
Handy, Internet, Strom, Gas, Kfz-Versicherung, Rechtsschutz, Fitnessstudio, Streaming und alles andere,
was regelmäßig Geld kostet. Contractly ist kein Vergleichsportal. Es verwaltet nur deine eigenen
Verträge, und alle Daten bleiben auf deinem Server.

## Aufbau

Contractly beantwortet vier Fragen – dafür gibt es vier Bereiche:

| Bereich | Frage | Darin |
|---|---|---|
| **Übersicht** | Wo stehe ich? | Fixkosten pro Monat, was als Nächstes zu tun ist, Kostenverlauf |
| **Verträge** | Was habe ich? | Alle Verträge als kompakte Liste (oder Kacheln), Details, Kredit, Zählerstände, Vergleich |
| **Zu tun** | Was muss ich erledigen? | Fristen & Erinnerungen · Post & Mails · Jahres-Check |
| **Auswertung** | Was kostet mich das? | Kosten & Prognose · Einnahmen · Zeitstrahl · Jahresbericht |

Selten Gebrauchtes liegt in den **Einstellungen**: Notfall-Mappe, Import, Backup, Benutzer und Sicherheit.

## Funktionen

| Bereich | Was du bekommst |
|---|---|
| **Dashboard** | Fixkosten pro Monat und Jahr, Veränderung zum Vorjahr, Kostenverlauf nach Bereichen (mit Vorschau), anstehende Fristen, größte Posten, Preisänderungen und die Ersparnis durch Wechsel |
| **Mitdenken** | **Plausibilitätsprüfung** beim Speichern (z. B. „1.299 € im Monat für Streaming – Komma vergessen?“, Arbeitspreis in Euro statt Cent, Abschlag deckt den Verbrauch nicht, Laufzeiten, die seit 2022 nicht mehr erlaubt sind). **Offene Angaben** je Vertrag (Anschrift, Kundennummer, Kündigungsfrist, Unterlagen, Verbrauch) mit Sprung ins Feld oder „Brauche ich nicht“. Beim Anlegen übernimmt ein **bekannter Anbieter** Anschrift, Kundennummer und Konto; passt der Name zu einer anderen Kategorie, schlägt Contractly sie vor. Auf der Übersicht **„Gut zu wissen“**: Kostenentwicklung und ihr Treiber, mehrere Abos einer Art, monatlich bezahlte Versicherungen, seit Jahren unveränderte Tarife |
| **Verträge** | Kompakte Liste (wahlweise Kacheln) mit Preis, Eckdaten (z. B. „40 GB · 5G · Telekom“) und Fristhinweis. Suche und ein Filter-Fenster für Bereich, Sortierung, Ansicht und beendete Verträge. Im Vertrag: „Verlängert sich am … · kündigen bis …“ auf einen Blick |
| **Vertrag anlegen** | Kategorie-Kachel antippen, Anbieter, Preis und Beginn eintragen, fertig. Laufzeiten und Kündigungsfristen sind je Kategorie vorbelegt; die Vorschau zeigt sofort, wann sich der Vertrag verlängert und bis wann du kündigen musst. **Oder: Vertrag hochladen**, dann füllt die Texterkennung (OCR) die Felder aus |
| **Eckdaten je Kategorie** | Mobilfunk (Datenvolumen, Netz, 5G …), Internet (Mbit/s, Technik), Strom/Gas (Grundpreis, Arbeitspreis, Verbrauch, Abschlag, Zähler), Kfz (SF-Klassen, SB, Kennzeichen), Rechtsschutz, Haftpflicht, Hausrat, Fitness, Streaming … |
| **Preisverlauf** | Preishistorie mit Datum, beliebige Zahlweise (monatlich bis jährlich oder **einmalig**), Einmalzahlungen und Boni |
| **Gesamtsumme** | Für Verträge mit festem Gesamtbetrag (z. B. Studiengebühren, Ratenkauf): Contractly zählt die Buchungen, warnt vor dem Überschreiten und berechnet die **abweichende letzte Rate**. Fehlende Zahlungsbestätigungen lassen sich wegklicken |
| **Eigene Felder** | Feldnamen wie „Kundennummer“ per Stift umbenennen, eigene Felder per **+** ergänzen, dazu „Verwaltet von“ (z. B. Makler, Partner) |
| **Zusatzkosten** | Teurere Einzelmonate (z. B. Auslandstelefonate, Roaming, Extra-Datenvolumen) als Mehrbetrag oder einfach als Rechnungsbetrag erfassen. Der Grundpreis bleibt, im Folgemonat gilt automatisch wieder der Basispreis. Im Plot als Punkte markiert, in der Hochrechnung optional als Ø der letzten 12 Monate |
| **Vergleichsmodul** | Angebote schnell eintragen. Contractly rechnet Einmalkosten, Boni, Aktionspreise und Laufzeit über 12/24/36 Monate gegen deinen Vertrag und sagt dir „Wechsel lohnt sich“, „geringe Ersparnis“ oder „lohnt nicht“. Dazu kommt ein Leistungsvergleich (z. B. 40 GB vs. 50 GB) |
| **Wechselboni** | Mehrere Boni je Angebot (Wechsel-, Neukunden-, Sofortbonus, Rufnummernmitnahme, Cashback) mit Auszahlungsmonat. Boni zählen nur, wenn sie im Vergleichszeitraum ausgezahlt werden. Umschalter „Mit/Ohne Boni“, Warnung „lohnt sich nur durch Bonus“ und Angabe, nach wie vielen Monaten der Vorteil aufgebraucht ist. Beim Wechsel werden Boni als Gutschrift im Auszahlungsmonat eingetragen, inklusive Erinnerung zur Kontrolle |
| **Wechsel** | Ein Klick beendet den alten Vertrag und legt den Nachfolger an. **Der Kostenplot läuft durchgehend weiter** (z. B. Fitnessstudio 35 € → Sportnavi 45 €). Das geht auch ohne Vergleichsmodul über „Anbieter oder Tarif wechseln“ |
| **Zeitstrahl** | Gantt-Ansicht: Vertragsbeginn, Wechsel (in derselben Zeile), Kündigungsfristen, heute. Dazu eine Chronik |
| **Kosten & Prognose** | **„Wohin dein Geld geht“**: Anteil jedes Bereichs an den Fixkosten (und am Netto-Einkommen, falls erfasst) auf einen Blick. Historie nach Bereich oder Vertrag. Hochrechnung bis 10 Jahre mit einstellbarer Preissteigerung, Summen pro Jahr und Vertrag |
| **Fristen** | Nächstes Laufzeitende und letzter Kündigungstag werden automatisch berechnet. „Monatlich kündbar“ wird erkannt und nicht als Alarm angezeigt |
| **Erinnerungen** | Automatisch vor jeder Kündigungsfrist (Vorlauf je Vertrag einstellbar), eigene Erinnerungen (auch wiederkehrend). Zustellung im Dashboard, als **Kalender-Abo (iCal)**, per **Push (ntfy)** oder **E-Mail** |
| **Kündigungsschreiben** | Fertiger Brief mit deinen Absenderdaten, Anbieter-Adresse und Kunden-, Vertrags-, Zähler- oder Rufnummer. Ordentlich oder Sonderkündigung, optional mit Rufnummernmitnahme und SEPA-Widerruf. Drucken/PDF, Kopieren, E-Mail |
| **Dokumente & OCR** | PDFs und Fotos je Vertrag ablegen. „Erkennen“ liest Kundennummer, Vertragsnummer, Anbieter-Adresse, Preise, Zählernummer, MaLo, IBAN, Vertragsbeginn usw. aus und schlägt sie zur Übernahme vor |
| **Strom & Gas** | Grundpreis und Abschlag wahlweise pro Monat oder pro Jahr. Der **Abschlag ist der Preis**, mit dem Contractly rechnet; darunter steht, wie viel du beim erwarteten Verbrauch nachzahlst oder zurückbekommst. Zählerstände erfassen (Gas in m³), daraus den Jahresverbrauch **prognostizieren**, Jahresabrechnung schätzen (Nachzahlung oder Guthaben, mit Spanne) und den Abschlag vorschlagen, mit dem keine Nachzahlung entsteht. **Erinnerung, wenn eine Nachzahlung droht.** Siehe [Verbrauchsprognose](#verbrauchsprognose-strom--gas) |
| **Backup** | Vollbackup (Datenbank und Dokumente), optional **AES-256-verschlüsselt mit eigenem Schlüssel**. Automatisch täglich oder wöchentlich, Upload in **OneDrive, Google Drive, Dropbox, Nextcloud, S3 …** (über rclone), Wiederherstellung in der Oberfläche |
| **Sicherheit** | Anmeldeseite mit eigenem Konto. **Automatische Abmeldung** nach einstellbarer Inaktivität, auch wenn nur der Tab geschlossen wird. **Datenbank, Dokumente (PDFs, Fotos) und Backups sind verschlüsselt gespeichert** (SQLCipher/AES-256). Der Schlüssel entsteht aus dem Passwort und liegt nur während der Anmeldung im Arbeitsspeicher. Nach dem Abmelden ist nichts mehr lesbar. Dazu Wiederherstellungsschlüssel, Schutz vor Passwort-Raten und Sicherheits-Header |
| **Mehrere Benutzer** | Jede Person hat einen **eigenen, getrennt verschlüsselten Bereich**. Der Admin lädt per Einladungscode ein; das Passwort legt die Person selbst fest, daher kann auch der Admin keine fremden Verträge lesen |
| **Post & Mails** | Brief fotografieren, PDF oder E-Mail (.eml) hineinziehen, Mail-Text einfügen oder am Handy *Teilen → Contractly*. Contractly erkennt **Preiserhöhung, neuen Abschlag, Jahresabrechnung, Kündigungsbestätigung, Vertragsbestätigung, neue AGB**, ordnet das Schreiben dem Vertrag zu (Kunden-/Vertragsnummer, Anbieter, Absender-Domain) und trägt mit einem Klick ein, was sich ändert. Das Schreiben wird verschlüsselt beim Vertrag abgelegt. Siehe [Post & Mails](#post--mails) |
| **Jahres-Check** | Einmal im Jahr, etwa 5 Minuten: nur die Verträge mit Handlungsbedarf (Aktionspreis ausgelaufen, teurer geworden, Bonus verbraucht, Preisgarantie endet, nie verglichen, Abo ungenutzt, Abschlag zu niedrig, Frist naht) – je Vertrag *Passt so*, *Vergleichen* oder *Kündigen*, am Ende Zusammenfassung mit Ersparnis und fertigen Kündigungsschreiben |
| **Notfall-Mappe** | Alles, was Angehörige brauchen: Verträge mit Nummern, Anschriften, Fristen, Unterlagen, Hinweisen für den Todesfall und vorbereitetem Kündigungsschreiben, dazu persönliche Hinweise. Zum Drucken oder als **eine verschlüsselte HTML-Datei**, die sich offline in jedem Browser mit Passwort öffnen lässt |
| **Kredite** | Ratenkredit, Baufinanzierung, Autokredit: aus Kreditbetrag, Sollzins und Rate berechnet Contractly **Restschuld, Zins- und Tilgungsanteil, bisherige und künftige Zinsen und das Schuldenfrei-Datum** (Verlauf als Grafik). Sondertilgungen eintragen, **Umschuldung oder Anschlussfinanzierung durchrechnen** (bei Ratenkrediten mit geschätzter Vorfälligkeitsentschädigung, max. 1 %), Erinnerung ein Jahr vor Ende der Zinsbindung und an die jährliche Sondertilgung. Die Rate zählt zu den Fixkosten und endet automatisch mit der letzten Rate |
| **Importieren** | **Vertragslisten** aus Excel/CSV übernehmen (Vorlage zum Download), Spalten werden automatisch erkannt. Die Dateien werden nicht gespeichert |
| **Alltagssituationen** | **Kostenanteil** (Partner zahlt einen Anteil oder festen Betrag), **Konten** (z. B. Gemeinschaftskonto), **Pausieren** (z. B. Fitnessstudio ruhend, auf Wunsch mit verlängerter Laufzeit), **Kündigungsbestätigung** nachverfolgen, automatische Erinnerungen an **Widerrufsfrist**, **Ende der Preisgarantie**, **angekündigte Preiserhöhungen** (Sonderkündigungsrecht), fehlende Kündigungsbestätigung und einen jährlichen **Abo-Check** („Nutzt du das noch?“). Hinweis auf **doppelte Verträge** beim Anlegen |
| **Jahresbericht & Steuer** | „Dein Vertragsjahr“: Kosten, Kategorien, Wechsel, Preisänderungen, druckbar als PDF. **Steuer-Export** (CSV) der steuerlich relevanten Verträge (Vorgabe je Kategorie, pro Vertrag änderbar) |
| **Zwei-Faktor-Anmeldung** | Optional per Authenticator-App (TOTP, QR-Code). Das Geheimnis ist mit dem Datenschlüssel verschlüsselt; der Wiederherstellungsschlüssel hilft auch bei verlorenem Handy |
| **Home Assistant** | Lesender API-Token: Monatskosten, nächste Frist und offene Erinnerungen als REST-Sensor (fertiges YAML zum Kopieren) |
| **Komfort** | Responsive für Desktop (Seitenleiste), Tablet (Icon-Leiste) und Smartphone (Navigation unten). Vertrag direkt mit der **Handykamera** fotografieren. Hell/Dunkel, Schnellsuche (Strg+K), **Rückgängig** nach Erledigen oder Löschen, als App installierbar (PWA), Demo-Daten zum Ausprobieren |

## Schnellstart

Fertige Images für x86 und ARM (Raspberry Pi, Synology & Co.) liegen unter
`ghcr.io/sv3n168/contractly`. Es reicht die `docker-compose.yml`:

```bash
mkdir contractly && cd contractly
curl -O https://raw.githubusercontent.com/sv3n168/contractly/main/docker-compose.yml
docker compose up -d
```

Updates: `docker compose pull && docker compose up -d`. Die Datenbank wird beim nächsten Anmelden
automatisch auf den neuen Stand migriert.

Selbst bauen: Repository klonen, in der `docker-compose.yml` `image:` durch `build: .` ersetzen und
`docker compose up -d --build` ausführen.

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
- Nach der Anmeldung liegt der Schlüssel im Arbeitsspeicher des Servers. In der Sitzungsdatenbank
  (`sessions.db`) steht er nur verschlüsselt mit einem Geheimnis, das ausschließlich im Cookie deines
  Browsers steckt. Deshalb übersteht eine Anmeldung einen Neustart und funktioniert auch mit mehreren
  Containern auf demselben Datenordner, ohne dass der Server die Daten alleine öffnen kann.
- **Abmelden** (bzw. Ablauf der Sitzung) löscht Schlüssel und Sitzung. Ab dann sind Datenbank und
  PDFs auch für den Server unlesbar.
- PDFs werden beim Ansehen im Arbeitsspeicher entschlüsselt. Für die Texterkennung entsteht kurz eine
  Kopie in `/dev/shm` (RAM), die danach sofort gelöscht wird.
- Damit **Erinnerungen und der Kalender** auch im abgemeldeten Zustand funktionieren, merkt sich
  Contractly pro Person die anstehenden Termine mit neutraler Bezeichnung (z. B. „Kündigungsfrist
  Mobilfunk-Vertrag“). Vertragsnamen erscheinen dort nur, wenn man das in den Einstellungen einschaltet.
- **Wichtig:** Betreibe Contractly außerhalb des Heimnetzes nur hinter HTTPS (z. B. Reverse Proxy
  mit Let's Encrypt), damit Passwörter verschlüsselt übertragen werden.

**Schutz der Anmeldeseite**

- **Einrichtung nur durch dich:** Wird ein frisch gestartetes Contractly von außerhalb des eigenen
  Netzes aufgerufen, verlangt die Einrichtung einen **Einrichtungscode**. Er steht im Container-Log
  (`docker logs contractly`). Aus dem Heimnetz geht es ohne Code.
- **Gegen Passwort-Raten:** höchstens 10 Fehlversuche pro Adresse und 20 pro Benutzername in
  15 Minuten. Das gilt auch für Einladungscodes und Wiederherstellungsschlüssel, übersteht Neustarts
  und gilt für alle Container gemeinsam. Jeder Fehlversuch verzögert die Antwort zusätzlich, und die
  Passwortprüfung (scrypt) ist absichtlich langsam.
- **Fehlversuche werden gemeldet:** Nach der Anmeldung zeigt Contractly, wie oft seit dem letzten
  Mal ein falsches Passwort oder ein falscher 2FA-Code eingegeben wurde.
- **Zwei-Faktor-Anmeldung** (Authenticator-App); jeder Code gilt nur einmal.
- Leicht zu erratende Passwörter (z. B. `passwort123` oder der eigene Benutzername) werden abgelehnt.
- Anfragen von fremden Webseiten, die Daten ändern wollen, werden abgewiesen (CSRF). Dazu kommen
  Cookies mit `SameSite=Strict` und `HttpOnly`, eine strenge Content-Security-Policy, Schutz vor
  Einbettung (Clickjacking) und HSTS über HTTPS.
- **Reverse Proxy:** Die echte Adresse eines Besuchers (`X-Forwarded-For`) wird nur von Proxys aus
  privaten Netzen übernommen (Docker-Netz, LAN). So kann sich niemand aus dem Internet eine falsche
  Adresse geben. Läuft dein Proxy woanders, setze `FORWARDED_ALLOW_IPS` auf seine Adresse.
- **fail2ban (optional):** Fehlversuche stehen im Log als `failed login from <IP>`. Ein Filter dafür:

  ```ini
  # /etc/fail2ban/filter.d/contractly.conf
  [Definition]
  failregex = failed login from <HOST>$
  ```

**Update von einer Version ohne Verschlüsselung:** Beim Einrichten des Admin-Kontos werden die
vorhandenen Daten aus `./data` in den Bereich des Admins übernommen, verschlüsselt, und die
unverschlüsselten Originale werden gelöscht. Die frühere Variable `CONTRACTLY_PASSWORD` wird nicht
mehr verwendet.

## Post & Mails

Unter *Post & Mails* landet alles, was ein Anbieter schickt:

- **Brief:** am Handy *Brief fotografieren*, sonst Foto oder PDF hineinziehen (Texterkennung mit Tesseract).
- **E-Mail:** als `.eml` speichern und hineinziehen – in Gmail *⋮ → Nachricht herunterladen*, in Outlook/Thunderbird
  *Speichern unter* bzw. die Mail auf den Desktop ziehen. Ein PDF-Anhang (z. B. die Rechnung) wird mitgelesen und abgelegt.
  Oder einfach den Text der Mail kopieren und einfügen.
- **Handy:** Contractly zum Startbildschirm hinzufügen, dann in der Mail-App *Teilen → Contractly*.

Contractly erkennt die Art des Schreibens und schlägt vor, was sich ändert – etwa „Neuer Preis 49,95 € ab 01.01.2027“
samt Erinnerung an das Sonderkündigungsrecht, „Nachzahlung 184,80 €“ und den neuen Abschlag oder „Kündigung bestätigt,
Vertragsende 31.12.2026“. Beträge und Daten lassen sich vor dem Übernehmen anpassen. Die Erkennung läuft vollständig
lokal (Regeln, keine KI-Cloud); `.msg`-Dateien aus Outlook werden nicht unterstützt.

## Jahres-Check und Notfall-Mappe

Der **Jahres-Check** ist jedes Jahr ab Mitte Januar fällig (erstmals im Jahr nach dem ersten erfassten Vertrag) und
erscheint als Erinnerung und auf dem Dashboard. *Passt so* gilt auch als Antwort auf den jährlichen Abo-Check.

Die **Notfall-Mappe** enthält nur laufende Verträge. Die verschlüsselte Datei nutzt AES-256-GCM mit einem per
PBKDF2-SHA256 (600.000 Runden) abgeleiteten Schlüssel; entschlüsselt wird im Browser der Angehörigen (WebCrypto),
ohne Internet und ohne Contractly. Bewahre das Passwort getrennt von der Datei auf, z. B. auf Papier bei den
Unterlagen. Nach größeren Änderungen (oder im Jahres-Check) einfach eine neue Datei erzeugen.

## Verbrauchsprognose (Strom & Gas)

Wer im Winter abliest, verbraucht gerade viel mehr als im Sommer. Einfaches Hochrechnen würde den
Jahresverbrauch dann stark überschätzen. Contractly rechnet deshalb mit einem kleinen, lokal laufenden
Modell (keine Cloud, keine Daten verlassen den Server):

1. **Typischer Jahresverlauf:** Für Gas (Heizung) und Haushaltsstrom ist hinterlegt, welcher Anteil des
   Jahresverbrauchs üblicherweise auf jeden Monat fällt. Bei „Heizstrom / Wärmepumpe“ wird der
   Heizverlauf berücksichtigt.
2. **Anpassung an die Ablesungen:** Jeder Zeitraum zwischen zwei Zählerständen wird mit dem verglichen,
   was der Verlauf für genau diese Tage erwartet. Daraus ergibt sich der Jahresverbrauch.
3. **Lernen:** Sobald die Ablesungen den größten Teil eines Jahres abdecken, passt Contractly den
   Verlauf an deinen Haushalt an (z. B. wenig Heizung, viel Warmwasser).
4. **Ehrliche Spanne:** Wie gut die Ablesungen zusammenpassen und wie viel vom Jahr noch fehlt, ergibt
   die Spanne. Vor einer drohenden Nachzahlung wird nur gewarnt, wenn sie auch im günstigen Fall eintritt.

Gaszähler zeigen m³. Umgerechnet wird mit dem Faktor von deiner Gasrechnung (Brennwert × Zustandszahl,
meist um 10 kWh/m³), einzutragen in den Vertragsdaten. Am genauesten wird die Prognose, wenn du etwa
einmal im Monat abliest.

## Konfiguration

Alle Einstellungen werden über Umgebungsvariablen gesetzt (siehe `docker-compose.yml`).

| Variable | Standard | Bedeutung |
|---|---|---|
| `CONTRACTLY_SESSION_HOURS` | `12` | Automatische Abmeldung nach so vielen Stunden Inaktivität |
| `CONTRACTLY_SESSION_DAYS_REMEMBER` | `30` | Sitzungsdauer bei „Angemeldet bleiben“ |
| `CONTRACTLY_PUBLIC_URL` | – | Externe URL, wird für Links in Benachrichtigungen verwendet |
| `CONTRACTLY_MAX_UPLOAD_MB` | `25` | Maximale Dateigröße für Dokumente |
| `PUID` / `PGID` | `1000` | Benutzer- und Gruppen-ID, der die Dateien in `./data` gehören |
| `FORWARDED_ALLOW_IPS` | private Netze | Proxys, deren `X-Forwarded-For`/`-Proto` übernommen wird |
| `TZ` | `Europe/Berlin` | Zeitzone |

### Erinnerungen per Push oder E-Mail

Jede Person trägt unter *Einstellungen → Benachrichtigungen* ihre E-Mail-Adresse und/oder ihr
ntfy-Thema ein. Erinnerungen kommen auch dann an, wenn man gerade abgemeldet ist. Die folgenden
Variablen konfigurieren den Server und gelten für den Admin zusätzlich als Vorgabe.
Mitglieder können öffentliche ntfy-Server oder den hier eingestellten Server nutzen; Adressen im
internen Netz (z. B. ein eigener ntfy auf dem NAS) darf nur ein Administrator für sich eintragen.

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
python -m pytest                                            # Backend-Tests
ruff check . && ruff format --check .                       # Python: Lint & Format

cd ../e2e && npm ci && npx playwright install chromium
PYTHON=../backend/.venv/bin/python npx playwright test      # Oberflächen-Tests (Desktop & Smartphone)
npm run lint                                                # Browser-Code (ESLint)
```

**Datenbank-Änderungen** laufen über Alembic-Migrationen (`backend/app/migrations/versions/`). Nach
einer Änderung an `models.py` eine neue Migration erzeugen:

```bash
python -c "from alembic import command; from sqlalchemy import create_engine; from app.migrate import alembic_config
e = create_engine('sqlite://')
with e.begin() as c:
    command.upgrade(alembic_config(c), 'head')
    command.revision(alembic_config(c), message='beschreibung', autogenerate=True)"
```

Migrationen werden automatisch ausgeführt, sobald eine Benutzer-Datenbank geöffnet wird.

Für OCR werden lokal `tesseract-ocr`, `tesseract-ocr-deu` und `poppler-utils` benötigt.

**Aufbau**

- `backend/app`: FastAPI, SQLAlchemy mit SQLCipher (verschlüsseltes SQLite, je Benutzer eine Datei
  unter `data/users/<id>/`). Benutzer, Sitzungen und Schlüssel stehen in `security.py`. Berechnungen für Kosten, Fristen und Vergleiche stehen in `calc.py`, Erinnerungen in `reminders.py`, Backups in `backup.py`, die Texterkennung in `ocr.py`.
- `frontend/`: Single-Page-App ohne Build-Schritt (ES-Module, Chart.js mitgeliefert, funktioniert offline).
- `e2e/`: Playwright-Tests der Oberfläche. Sie laufen in der CI, zusammen mit den Backend-Tests und
  einem Docker-Smoke-Test. Bei jedem Push auf `main` wird das Multi-Arch-Image veröffentlicht.
- REST-API mit interaktiver Doku unter `/docs`.

Änderungen je Version stehen im [CHANGELOG](CHANGELOG.md), Sicherheitshinweise in [SECURITY.md](SECURITY.md).

## Lizenz

Chart.js steht unter der MIT-Lizenz (`frontend/vendor/chart.js.LICENSE.md`).
