import { hostname } from 'node:os'

/** This computer's name as a person knows it: its host name, without the `.local` a Mac adds on its network. */
export function computerName(): string {
  return hostname().replace(/\.local$/i, '')
}
