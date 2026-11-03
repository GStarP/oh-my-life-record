import { readPreference, writePreference } from '../../preferences/device'
import type { R2Config } from '../cloud.type'
import type { CredentialDraft } from './credential.type'
const CREDENTIAL_KEY = 'cloud-credential'
const DRAFT_KEY = 'cloud-credential-draft'
function read(key: string): CredentialDraft | undefined {
  try { const text = readPreference(key); return text ? JSON.parse(text) : undefined } catch { return undefined }
}
export function hasCredential(config: R2Config | undefined): boolean {
  return Boolean(config && [config.endpoint, config.bucket, config.accessKeyId, config.accessKeySecret].every((value) => typeof value === 'string' && value.trim()))
}
export function getCredential(): R2Config | undefined {
  const config = read(CREDENTIAL_KEY)
  return config && hasCredential(config) ? config : undefined
}
export function getCredentialDraft(): CredentialDraft | undefined { return read(DRAFT_KEY) ?? getCredential() }
export async function setCredential(config: CredentialDraft): Promise<void> {
  await writePreference(CREDENTIAL_KEY, JSON.stringify({ ...config, bucket: config.bucket.trim() }))
  await writePreference(DRAFT_KEY, null)
}
export async function setCredentialDraft(config: CredentialDraft): Promise<void> { await writePreference(DRAFT_KEY, JSON.stringify(config)) }
