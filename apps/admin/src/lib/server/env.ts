import 'server-only'
import { parseAdminEnv, type AdminEnv } from '../env'

export function getAdminEnv(): AdminEnv {
  return parseAdminEnv(process.env)
}
