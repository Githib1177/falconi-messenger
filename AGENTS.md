# Falconi Messenger — pravidla změn a nasazení

- Produkce: https://falconi-messenger.vercel.app/.
- Vercel projekt: falconi-messenger, ID prj_yiUQvxCmtv5UfHea6v0N8WErWcfG.
- Tým: team_CS43ru0uiLzYd40tktKXt3QZ (falconis-projects-9c8c91c8).
- Repozitář: Githib1177/falconi-messenger. Původní název Link-builder-sms je jen starý odkaz.
- Nikdy nepoužívat archive-link-builder-sms-do-not-deploy pro nasazení.
- Neodvozovat produkční verzi od nejnovějšího buildu, názvu větve ani názvu projektu. Ověřit skutečné přiřazení domény a ID aktivního deploymentu.
- Produkce je záměrně odpojena od automatického Git nasazování. Nezapínat jej jako vedlejší účinek úpravy kódu.
- Před úpravou zaznamenat aktivní deployment a porovnat zdroje. Záloha je v backup/production-2026-09-25, kontrolní součty v ops/production-baseline.json.
- Před jakýmkoli nasazením musí být v aktuální konverzaci výslovně schválené nasazení konkrétní změny. Schválení úklidu repozitáře neznamená schválení nové verze aplikace.
- Nejprve testy, kontrola rozdílu a oddělený testovací deployment. Produkční sestavení připravit bez přiřazení domény, ověřit a až pak ručně povýšit. Uchovat ID předchozí verze pro návrat.
- Produkční nasazení nikdy neodstraňovat kvůli názvu staging. Původní produkční projekt se tak jmenoval do 8. 10. 2026.
- Žádné živé SMS, příkazy ke schránkám, změny karet či zápisy produkčních dat jako vedlejší účinek testování.
- Zachovat autentizaci, historii, doručenky, Wallet, odkazy pro hosty, schránky i noční souhrny. Nespouštět ani nezapínat souhrny při údržbě.
- Hesla, tokeny a hodnoty prostředí neukládat do GitHubu, dokumentace ani klienta.
