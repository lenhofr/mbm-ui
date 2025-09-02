// Amplify configuration for Cognito SRP embedded auth
// Expected Vite env vars:
// - VITE_COGNITO_USER_POOL_ID
// - VITE_COGNITO_USER_POOL_WEB_CLIENT_ID
// Optional (for future Hosted UI fallback / federated):
// - VITE_COGNITO_DOMAIN
// - VITE_COGNITO_REDIRECT_URI
// - VITE_COGNITO_REGION
import { Amplify } from 'aws-amplify'

const env = (import.meta as any).env

const userPoolId = env.VITE_COGNITO_USER_POOL_ID as string | undefined
const userPoolClientId = env.VITE_COGNITO_USER_POOL_WEB_CLIENT_ID as string | undefined
const region = (env.VITE_COGNITO_REGION as string | undefined) || (userPoolId ? userPoolId.split('_')[0].split('-').slice(0,3).join('-') : undefined)

if (!userPoolId || !userPoolClientId) {
  // eslint-disable-next-line no-console
  console.warn('[auth] Missing Cognito env (VITE_COGNITO_USER_POOL_ID / VITE_COGNITO_USER_POOL_WEB_CLIENT_ID). Auth will be disabled.')
}

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: userPoolId ?? '',
      userPoolClientId: userPoolClientId ?? '',
      // region is optional; inferred from userPoolId if omitted
      // @ts-ignore - region is supported but optional in v6
      region: region,
      signUpVerificationMethod: 'code',
      loginWith: {
        // enable email as primary login input; adjust if you use username/phone
        email: true,
        username: false,
        phone: false,
      },
    },
  },
})

// No exports; importing this file is enough to configure Amplify
