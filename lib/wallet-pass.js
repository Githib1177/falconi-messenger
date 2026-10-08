// This module accepts server-side records, never request bodies or guest query parameters.
// Reception snapshots must be created only after authenticating the operator.
const localized = value => ({ defaultValue: { language: 'cs', value } });
const FRESHNESS_MS = 5 * 60 * 1000;
const logo = { sourceUri: { uri: 'https://files.previo.cz/85/www/logo.png' }, contentDescription: localized('Pension Falconi') };

export function alfredDetails(input) {
  let code = String(input || '').trim();
  if (code.startsWith('https://')) {
    const url = new URL(code);
    if (url.origin !== 'https://alfred.previo.app' || url.search || url.hash || url.username || url.password) throw new Error('Neplatný odkaz Alfréd.');
    const match = /^\/login\/([A-Za-z0-9]{6,32})\/?$/.exec(url.pathname);
    if (!match) throw new Error('Neplatný odkaz Alfréd.');
    code = match[1];
  }
  if (!/^[A-Za-z0-9]{6,32}$/.test(code)) throw new Error('Neplatný Alfréd kód.');
  return { code, url: `https://alfred.previo.app/login/${code}` };
}

export function accessDecision(stay, snapshot, locker, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error('Neplatný čas.');
  if (!stay || !Number.isFinite(stay.expiresAt) || !Number.isFinite(stay.releaseAt) || stay.releaseAt >= stay.expiresAt) throw new Error('Chybí platnost pobytu.');
  if (stay.cancelled === true || now >= stay.expiresAt) return 'expired';
  if (now < stay.releaseAt) return 'pending';
  if (!snapshot || !['previo','reception'].includes(snapshot.source) || snapshot.hotelId !== '85'
      || snapshot.reservationId !== stay.reservationId || snapshot.alfredCode !== alfredDetails(stay.alfred).code
      || !Number.isFinite(snapshot.verifiedAt) || snapshot.verifiedAt > now || now - snapshot.verifiedAt > FRESHNESS_MS
      || snapshot.active !== true || snapshot.checkinComplete !== true || snapshot.paymentComplete !== true) return 'pending';
  if (!locker || locker.reservationId !== stay.reservationId || locker.assignmentId !== stay.lockerAssignmentId
      || !stay.lockerAssignmentId || locker.programmingConfirmed !== true || locker.cardPrepared !== true
      || !Number.isFinite(locker.validFrom) || !Number.isFinite(locker.validUntil)
      || now < locker.validFrom || now >= locker.validUntil || !/^\d{6}$/.test(locker.code)) return 'pending';
  return 'ready';
}

export function buildWalletObject(stay, snapshot, locker, config, now = Date.now()) {
  if (!/^[0-9]+$/.test(config.issuerId) || !/^[A-Za-z0-9_-]+$/.test(config.classSuffix)
      || !/^[a-f0-9-]{36}$/.test(stay.passId) || !String(stay.reservationId || '').trim()) throw new Error('Chybí identifikace karty.');
  const decision = accessDecision(stay, snapshot, locker, now);
  const alfred = alfredDetails(stay.alfred);
  const active = decision !== 'expired';
  return {
    id: `${config.issuerId}.${stay.passId}`,
    classId: `${config.issuerId}.${config.classSuffix}`,
    genericType: 'GENERIC_RESERVATIONS', state: active ? 'ACTIVE' : 'EXPIRED',
    cardTitle: localized('Pension Falconi'), logo, wideLogo: logo, hexBackgroundColor: '#303438',
    // Coordinates linked by the official Pension Falconi website.
    merchantLocations: active ? [{ latitude: 50.0297271, longitude: 15.1970306 }] : [],
    subheader: localized(decision === 'ready' ? 'VÁŠ KÓD KE SCHRÁNCE' : active ? 'ALFRÉD • CHECK-IN' : 'POBYT UKONČEN'),
    header: localized(decision === 'ready' ? locker.code : active ? alfred.code : 'Děkujeme za návštěvu'),
    textModulesData: [
      { id: 'alfred', header: 'Alfréd kód', body: alfred.code },
      ...(active ? [{ id: 'instructions', header: 'Převzetí karty', body: decision === 'ready'
        ? 'Ke kiosku už nemusíte. Zadejte kód na klávesnici schránek. Správná schránka se otevře automaticky.'
        : 'Dokončete check-in a platbu v Alfrédovi, případně použijte Alfréd kód u kiosku. Přístupový kód se doplní po ověření podmínek a připravení schránky.' }
    ] : [])
    ],
    linksModuleData: { uris: [
      ...(active ? [{ id: 'checkin', uri: alfred.url, description: 'Dokončit online check-in • Alfréd / Previo' }] : []),
      { id: 'reception', uri: 'tel:+420735024000', description: 'Zavolat recepci' }
    ] },
    validTimeInterval: { end: { date: new Date(stay.expiresAt).toISOString() } }
  };
}
