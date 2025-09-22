import { SignJWT, jwtVerify } from 'jose';

const encoder = new TextEncoder();

export function getSocketToken(
	subject: string,
	audience: string,
	secret: string,
) {
	const builder = new SignJWT({
		sub: subject,
		aud: audience,
		exp: Math.floor(Date.now() / 1000) + 60 * 60,
	})
		.setProtectedHeader({
			alg: 'HS256',
		})
		.setIssuedAt()
		.setExpirationTime('1h')
		.setSubject(subject)
		.setAudience(audience);
	return builder.sign(encoder.encode(secret));
}

export async function verifySocketToken({
	token,
	secret,
	audience,
}: {
	token: string;
	secret: string;
	audience: string;
}) {
	const result = await jwtVerify(token, encoder.encode(secret));
	if (result.payload.aud !== audience) {
		throw new Error('Invalid audience');
	}
	return result.payload as { sub: string; aud: string };
}
