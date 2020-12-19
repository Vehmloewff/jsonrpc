import { makeEncryptor } from './utils.ts'

// export type Parameters = string | boolean | number | null | { [key: string]: Parameters } | Parameters[]
export type Parameters = any

export interface ErrorResponse {
	code: number
	message: string
	data?: Parameters
}

export const paramsEncoder = makeEncryptor('nothing-secret')
