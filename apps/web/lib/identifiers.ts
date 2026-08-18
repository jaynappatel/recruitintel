const COMPANY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCompanyIdentifier(value: string): boolean {
  return value.length <= 100 && (COMPANY_SLUG.test(value) || UUID.test(value));
}

export function isSchoolIdentifier(value: string): boolean {
  return isCompanyIdentifier(value);
}

export function isDatabaseUuid(value: string): boolean {
  return UUID.test(value);
}
