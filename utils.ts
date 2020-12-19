export const makeArray = <T>(val: T | T[]) => (Array.isArray(val) ? val : [val])

export const asyncForEach = async <T>(arr: T[], cb: (item: T, index: number) => Promise<unknown> | unknown) => {
	for (let index = 0; index < arr.length; index++) await cb(arr[index], index)
}

export function makeEncryptor(key: string) {
	const textToChars = (text: string) => text.split('').map(c => c.charCodeAt(0))
	const byteHex = (n: number) => ('0' + Number(n).toString(16)).substr(-2)
	const applyKeyToChar = (code: number) => textToChars(key).reduce((a, b) => a ^ b, code)

	function decrypt(encoded: string) {
		return (encoded.match(/.{1,2}/g) || [])
			.map(hex => parseInt(hex, 16))
			.map(applyKeyToChar)
			.map(charCode => String.fromCharCode(charCode))
			.join('')
	}

	function encrypt(text: string) {
		return textToChars(text).map(applyKeyToChar).map(byteHex).join('')
	}

	return { encrypt, decrypt }
}

export function lazyJSONParse(json: string): any {
	try {
		return JSON.parse(json)
	} catch (e) {
		return {}
	}
}

export function delay(time: number) {
	return new Promise<void>(resolve => {
		setTimeout(() => resolve(), time)
	})
}
