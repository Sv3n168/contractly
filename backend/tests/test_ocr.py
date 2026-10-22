from app import ocr

SAMPLE = """
Stadtwerke Musterstadt GmbH                         Max Mustermann
Hauptstraße 12                                      Lindenweg 3
12345 Musterstadt                                   54321 Beispielort

Ihr Stromliefervertrag
Kundennummer: 4711 0815
Vertragskontonummer: 2003456789
Zählernummer: 1ESY1160234567
Marktlokation: 50123456789
Lieferbeginn: 01.03.2024
Grundpreis 13,90 € pro Monat
Arbeitspreis 29,85 ct/kWh
Jahresverbrauch 2.800 kWh
Ihr monatlicher Abschlag beträgt 82,00 €
IBAN DE89 3704 0044 0532 0130 00
"""


def test_detect_fields():
    found = {s["key"]: s["value"] for s in ocr.detect_fields(SAMPLE)}
    assert found["customer_number"] == "4711 0815"
    assert found["contract_number"] == "2003456789"
    assert found["meter_number"] == "1ESY1160234567"
    assert found["market_location"] == "50123456789"
    assert found["start_date"] == "2024-03-01"
    assert found["base_price_month"] == 13.90
    assert found["unit_price_ct"] == 29.85
    assert found["consumption_kwh"] == 2800
    assert found["price"]["interval"] == "monthly"
    assert found["iban"] == "DE89370400440532013000"
    assert found["provider_address"] == "Stadtwerke Musterstadt GmbH\nHauptstraße 12\n12345 Musterstadt"
    assert found["provider"] == "Stadtwerke Musterstadt GmbH"


def test_side_by_side_addresses_from_ocr():
    text = """Fitx Deutschland GmbH Max Mustermann

Brüsseler Straße 12 Lindenweg 3
45127 Essen 54321 Beispielort

Kundennummer: 4400 1928
Ihr Monatsbeitrag beträgt 35,00 € pro Monat.
"""
    found = {s["key"]: s["value"] for s in ocr.detect_fields(text)}
    assert found["provider_address"] == "Fitx Deutschland GmbH\nBrüsseler Straße 12\n45127 Essen"
    assert found["provider"] == "Fitx Deutschland GmbH"
    assert found["price"] == {"amount": 35.0, "interval": "monthly"}
