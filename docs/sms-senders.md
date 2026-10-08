# Oddělení odesílatelů SMS

Změna není nasazená. Hesla, přihlášení k bráně a stávající PIN schránek se nemění.

## Serverová konfigurace před budoucím nasazením

- `SMS_SYSTEM_SENDER_ID`: ID odesílatele v SMSbráně odpovídající **stávajícímu systémovému číslu**, které schránky již přijímají. Získat z existujícího účtu; neodhadovat a nenahrazovat novým provozním číslem.
- `SMS_GUEST_SENDER_ID`: ID schváleného odesílatele pro běžné zprávy hostům. Lze měnit nezávisle na systémovém odesílateli.
- `SMS_LOGIN` a `SMS_PASSWORD`: stávající hodnoty beze změny.

Jde o hodnotu parametru `sender_id` služby SMS Connect, ne automaticky telefonní číslo. Parametr používá i [oficiální klient SMSbrány](https://github.com/smsbrana/sms-connect/blob/master/src/SmsConnect.php). Obě ID patří pouze do prostředí serveru. Neukládat skutečné hodnoty do HTML ani repozitáře.

Podle snímku nastavení SMSbrány z 8. 10. 2026 a volby uživatele jsou připravené serverové hodnoty `SMS_SYSTEM_SENDER_ID=0` (Systémové číslo) a `SMS_GUEST_SENDER_ID=30514` (InfoSMS). Při budoucím nasazení je nastavit do prostředí serveru. Výchozí hvězdičku v SMSbráně ponechat u systémového čísla. Kód při chybějícím nebo neplatném ID odmítne daný typ zprávy (503); nikdy nepoužije výchozího ani druhého odesílatele. Nastavení výchozího čísla v SMSbráně se touto změnou nemění.

## Kontrakt

`POST /api/send-sms` vyžaduje `{type: "guest" | "locker", to, text}`. Starý požadavek bez typu se bezpečně odmítne (400); klient a server se musí aktualizovat společně. Jiná klientská pole včetně pokusů o zadání odesílatele se odmítají.

Hostovské SMS nemohou směřovat na stávající číslo schránek, ani v lokálním formátu nebo jako část dávky. Text ve tvaru systémového příkazu nelze poslat jako zprávu hostovi. Typ `locker` přijímá pouze jedno stávající číslo schránek a příkaz pro schránku 01–08 se šestimístným kódem. Každá transportní i kódovací varianta předává stejné serverem zvolené `sender_id`.

Přihlašovací údaje se nemění; diagnostika již nevypisuje celý požadavek s heslem a textem a nevrací syrovou odpověď brány klientovi. Tato změna nepřidává přihlášení uživatelů ani potvrzení fyzického překódování schránky. Úspěch API potvrzuje pouze přijetí SMS bránou.

## Ověření

`npm test` (Node.js 22.7+). Testy nahrazují `fetch` a neodesílají skutečné SMS. Pokrývají oba odesílatele, oddělení konfigurace, chybějící typ/ID, podvržená pole, ochranu příjemce a příkazů, všech osm stávajících transportních variant a omezení úniku citlivých hodnot v odpovědi.

Živé ověření přiřazení ID ke skutečnému číslu nebylo provedeno; není součástí testů bez nasazení.
