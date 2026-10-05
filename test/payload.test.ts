import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildPayload,
    emailPayload,
    escapeVcard,
    escapeWifi,
    locationPayload,
    phonePayload,
    smsPayload,
    urlPayload,
    vcardPayload,
    wifiPayload,
} from "../src/shared/payload";
import { DEFAULT_FIELDS, type Fields } from "../src/shared/spec";

const fields = (patch: Partial<Fields>): Fields => ({
    ...DEFAULT_FIELDS,
    ...patch,
});

const payloadOf = (result: ReturnType<typeof buildPayload>): string => {
    assert.ok(result.ok, result.ok ? "" : result.message);
    return result.payload;
};

test("a link without a scheme gets https, one with a scheme is kept", () => {
    assert.equal(
        payloadOf(urlPayload(" drawdy.io/b?id=4 ")),
        "https://drawdy.io/b?id=4"
    );
    assert.equal(payloadOf(urlPayload("http://a.example")), "http://a.example");
    assert.equal(
        payloadOf(urlPayload("ftp://files.example/x")),
        "ftp://files.example/x"
    );
});

test("an empty or spaced link is refused with a message", () => {
    const blank = urlPayload("   ");
    assert.equal(blank.ok, false);
    assert.equal(!blank.ok && blank.empty, true);
    const spaced = urlPayload("drawdy io");
    assert.equal(spaced.ok, false);
    assert.equal(!spaced.ok && spaced.empty, false);
});

test("Wi-Fi escapes backslash, semicolon, comma, colon and quote", () => {
    assert.equal(escapeWifi(`a\\b;c,d:e"f`), `a\\\\b\\;c\\,d\\:e\\"f`);
    const payload = payloadOf(
        wifiPayload(
            fields({ ssid: "Cafe;Guest", password: "p\\a;ss", security: "WPA" })
        )
    );
    assert.equal(payload, "WIFI:T:WPA;S:Cafe\\;Guest;P:p\\\\a\\;ss;;");
});

test("Wi-Fi marks hidden networks and drops the password for None", () => {
    assert.equal(
        payloadOf(
            wifiPayload(
                fields({
                    ssid: "Lab",
                    password: "x",
                    security: "WEP",
                    hidden: true,
                })
            )
        ),
        "WIFI:T:WEP;S:Lab;P:x;H:true;;"
    );
    assert.equal(
        payloadOf(
            wifiPayload(
                fields({
                    ssid: "Open",
                    password: "ignored",
                    security: "nopass",
                })
            )
        ),
        "WIFI:T:nopass;S:Open;;"
    );
    assert.equal(
        wifiPayload(fields({ ssid: "Lab", security: "WPA" })).ok,
        false
    );
});

test("email builds a percent-encoded mailto link with CRLF line breaks", () => {
    assert.equal(
        payloadOf(
            emailPayload(
                fields({
                    emailTo: "hello@example.com, team@example.com",
                    emailSubject: "Hi & welcome?",
                    emailBody: "Line one\nLine two",
                })
            )
        ),
        "mailto:hello@example.com,%20team@example.com?subject=Hi%20%26%20welcome%3F&body=Line%20one%0D%0ALine%20two"
    );
    assert.equal(
        payloadOf(emailPayload(fields({ emailTo: "a@b.co" }))),
        "mailto:a@b.co"
    );
});

test("phone and SMS strip separators and keep the plus sign", () => {
    assert.equal(
        payloadOf(phonePayload("+1 (555) 010-9999")),
        "tel:+15550109999"
    );
    assert.equal(phonePayload("call me").ok, false);
    assert.equal(
        payloadOf(
            smsPayload(
                fields({
                    smsNumber: "+66 81 234 5678",
                    smsMessage: "At 5: room 3",
                })
            )
        ),
        "SMSTO:+66812345678:At 5: room 3"
    );
});

test("vCard 3.0 escapes commas, semicolons, backslashes and new lines", () => {
    assert.equal(escapeVcard("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
    const payload = payloadOf(
        vcardPayload(
            fields({
                name: "Ada King, Lovelace",
                org: "Analytical Engines; Ltd.",
                contactPhone: "+44 20 7946 0000",
                contactEmail: "ada@example.com",
                website: "https://example.com/ada",
            })
        )
    );
    assert.equal(
        payload,
        [
            "BEGIN:VCARD",
            "VERSION:3.0",
            "N:Lovelace;Ada King\\,;;;",
            "FN:Ada King\\, Lovelace",
            "ORG:Analytical Engines\\; Ltd.",
            "TEL:+442079460000",
            "EMAIL:ada@example.com",
            "URL:https://example.com/ada",
            "END:VCARD",
        ].join("\r\n")
    );
});

test("a vCard with only an organisation names the card after it", () => {
    assert.equal(
        payloadOf(vcardPayload(fields({ org: "Drawdy" }))),
        "BEGIN:VCARD\r\nVERSION:3.0\r\nN:;;;;\r\nFN:Drawdy\r\nORG:Drawdy\r\nEND:VCARD"
    );
    assert.equal(vcardPayload(fields({})).ok, false);
});

test("a location is a geo URI with checked, rounded coordinates", () => {
    assert.equal(
        payloadOf(
            locationPayload(fields({ lat: "13.75633099", lng: "100.5018" }))
        ),
        "geo:13.756331,100.5018"
    );
    assert.equal(locationPayload(fields({ lat: "91", lng: "0" })).ok, false);
    assert.equal(locationPayload(fields({ lat: "1", lng: "east" })).ok, false);
    assert.equal(locationPayload(fields({ lat: "1" })).ok, false);
});

test("buildPayload routes each content type to its builder", () => {
    const all = fields({
        url: "drawdy.io",
        text: "plain words",
        ssid: "Lab",
        password: "pw",
        emailTo: "a@b.co",
        phone: "123",
        smsNumber: "456",
        smsMessage: "hi",
        name: "Ada",
        lat: "1",
        lng: "2",
    });
    assert.equal(payloadOf(buildPayload("url", all)), "https://drawdy.io");
    assert.equal(payloadOf(buildPayload("text", all)), "plain words");
    assert.equal(
        payloadOf(buildPayload("wifi", all)),
        "WIFI:T:WPA;S:Lab;P:pw;;"
    );
    assert.equal(payloadOf(buildPayload("email", all)), "mailto:a@b.co");
    assert.equal(payloadOf(buildPayload("phone", all)), "tel:123");
    assert.equal(payloadOf(buildPayload("sms", all)), "SMSTO:456:hi");
    assert.match(payloadOf(buildPayload("contact", all)), /^BEGIN:VCARD\r\n/);
    assert.equal(payloadOf(buildPayload("location", all)), "geo:1,2");
});
