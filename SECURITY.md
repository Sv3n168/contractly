# Sicherheit

Contractly speichert sensible Daten (Verträge, Kontonummern, Dokumente). Sicherheitslücken bitte
**nicht** als öffentliches Issue melden, sondern vertraulich über
[GitHub Security Advisories](https://github.com/sv3n168/contractly/security/advisories/new).

Bitte beschreibe, was betroffen ist, wie es sich nachvollziehen lässt und welche Version
(Einstellungen → Über Contractly) du verwendest.

## Unterstützte Versionen

Sicherheitsupdates gibt es für die jeweils aktuelle Version (`ghcr.io/sv3n168/contractly:latest`).

## Wie Contractly Daten schützt

Kurzfassung, Details im [README](README.md#erste-schritte--sicherheit):

- Jede Person hat eine eigene, mit SQLCipher (AES-256) verschlüsselte Datenbank; Dokumente und
  Backups sind ebenfalls verschlüsselt.
- Der Schlüssel entsteht aus dem Passwort (scrypt) und liegt nur während einer Sitzung im Speicher.
  Nach Abmelden oder Ablauf der Sitzung (auch automatisch bei Inaktivität) ist nichts mehr lesbar.
- Schutz vor Passwort-Raten, Zwei-Faktor-Anmeldung, CSRF-Schutz, strenge Content-Security-Policy.
- Contractly außerhalb des Heimnetzes nur hinter HTTPS betreiben.
