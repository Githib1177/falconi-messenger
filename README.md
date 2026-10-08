# Falconi Messenger

Jediný produkční Messenger pro Pension Falconi: https://falconi-messenger.vercel.app/.

## Správné cíle

| Služba | Identifikace |
| --- | --- |
| GitHub | Githib1177/falconi-messenger |
| Vercel | falconi-messenger |
| ID projektu | prj_yiUQvxCmtv5UfHea6v0N8WErWcfG |
| Tým | falconis-projects-9c8c91c8 |
| Zachovaná produkce | dpl_2NGovkYn3rF4esH5qRm6CPuywNpZ |

Projekt Vercel se dříve jmenoval link-builder-sms-staging. Jeho přejmenování nemění identitu ani provoz aplikace. Starý druhý projekt archive-link-builder-sms-do-not-deploy je pozastavený a odpojený od GitHubu.

## Obnova zdrojů 8. 10. 2026

Runtime soubory byly obnoveny z aktivního nasazení z 25. září. Všech 55 souborů uvedených v ops/production-baseline.json odpovídá bajt po bajtu Vercel file UID (SHA-1). Šest HTML testovacích fixtures a .gitignore pochází z původní větve wallet-release; nejsou součástí tohoto kontrolního manifestu. Záložní větev backup/production-2026-09-25 uchovává výchozí stav před novými úpravami. Starý main je zachovaný v archive/pre-recovery-main-2026-10-08.

## Testy a nasazování

```sh
npm install --ignore-scripts --package-lock=false
npm test
node scripts/verify-production-baseline.mjs
```

Poslední příkaz ověřuje shodu s obnovenou produkcí, nikoli funkční správnost budoucí změny. Při záměrné změně zdrojů musí rozdíl projít kontrolou; manifest není dovoleno přepisovat jen proto, aby kontrola prošla.

Git push ani merge nenasazuje produkci. Git integrace ve Vercelu je odpojená. CI pouze spouští testy a nemá nasazovací přihlašovací údaje. Nové verze nejdříve ověřit na odděleném náhledu, následně připravit produkční sestavení bez přepnutí domény a po výslovném schválení ručně povýšit. Podrobná pravidla jsou v AGENTS.md.

Hodnoty prostředí zůstávají v původním projektu Vercelu. Při sjednocení názvů se neměnila hesla, data, konfigurace schránek ani odesílatelé SMS.
