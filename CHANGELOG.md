# Changelog

Alle nennenswerten Änderungen an Contractly. Versionen folgen [Semantic Versioning](https://semver.org/lang/de/).

## 1.1.0 – unveröffentlicht

### Neu

- **Plausibilitätsprüfung beim Speichern:** Hinweis auf wahrscheinliche Tippfehler (Preis ohne Komma,
  Jahres- statt Monatsbetrag, Arbeitspreis in Euro statt Cent, Abschlag passt nicht zum Verbrauch,
  Laufzeiten, die seit 01.03.2022 nicht mehr erlaubt sind). „Korrigieren“ springt ins Feld.
- **Offene Angaben** je Vertrag (Anschrift, Kundennummer, Kündigungsfrist, Unterlagen, Verbrauch) mit
  Sprung ins Feld oder „Brauche ich nicht“. Auf der Übersicht quittierbar.
- **„Gut zu wissen“** auf der Übersicht: Kostenentwicklung und ihr Treiber, mehrere Abos einer Art,
  monatlich bezahlte Versicherungen, seit Jahren unveränderte Tarife.
- Beim Anlegen übernimmt ein **bekannter Anbieter** Anschrift, Kundennummer und Konto; passt der Name
  zu einer anderen Kategorie, schlägt Contractly sie vor.
- Version und Build unter *Einstellungen → Über Contractly*.

### Verbessert

- Einheitliche Abstände in der ganzen Oberfläche.
- README auf den aktuellen Stand gebracht; `SECURITY.md`, Changelog, Dependabot.
- Prüfung des Browser-Codes (ESLint) in der CI.

### Behoben

- Das Monatsfeld im Dialog für Zusatzkosten hat das Format „JJJJ-MM“ nicht geprüft.
- Beim schnellen Seitenwechsel konnte eine noch ladende Seite (z. B. die Übersicht) die gerade
  geöffnete überschreiben.
- Nach dem Speichern einer Einnahmequelle verschwanden die Reiter von „Auswertung“.
- Das Vertragsformular war auf dem Handy breiter als der Bildschirm.

## 1.0.0

Erste Version: Verträge mit Preisverlauf, Fristen und Erinnerungen, Wechsel mit durchgehendem
Kostenverlauf, Vergleichsmodul mit Wechselboni, Strom & Gas mit Verbrauchsprognose, Kredite,
Post & Mails, Jahres-Check, Notfall-Mappe, Auswertung mit Prognose, Einnahmen, Jahresbericht und
Steuer-Export, verschlüsselte Datenbank je Person, Zwei-Faktor-Anmeldung, Backups in die Cloud,
Home-Assistant-Anbindung, Hell/Dunkel, PWA.
