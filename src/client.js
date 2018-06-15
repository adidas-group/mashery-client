/*
  Mashery API client inspired with https://github.com/Cox-Automotive/mashery-node
  Supports same methods as in client mentioned above with same api `updateService(id, data)`
  Is only Promise driven

  Usage:../index
    const MasheryClient = require('./lib/client')
    const api = new MasheryClient({ credentials: { username, password, key, secret, scope } })
    api.fetchAllServices().then(console.log).catch(console.error)
*/

const { authenticate, refreshToken } = require('./lib/auth')
const { registerClientMethods } = require('./lib/request')
const {
  MasheryClientError,
  AuthenticationError,
  RequestError
} = require('./lib/errors')

const defaultOptions = {
  threads: 3,
  host: 'https://api.mashery.com',
  tokenEndpoint: '/v3/token',
  resourceEndpoint: '/v3/rest'
}

// TODO: add option to enable single pipe requests to prevent cross trigger qps
class MasheryClient {
  constructor ({
    credentials,
    onAuthenticationSuccess,
    onAuthenticationError,
    ...options
  } = {}) {
    this.options = Object.assign(defaultOptions, options)
    this.credentials = credentials || {}
    this.onAuthenticationSuccess = onAuthenticationSuccess
    this.onAuthenticationError = onAuthenticationError

    this.handleAuthenticationDone = this.handleAuthenticationDone.bind(this)
    this.handleAuthenticationError = this.handleAuthenticationError.bind(this)

    registerClientMethods(this)
  }

  isAuthenticated () {
    const { accessToken, refreshToken, tokenExpiresAt } = this.credentials
    return accessToken && refreshToken && tokenExpiresAt
  }

  requireAuthentication () {
    if (!this.isAuthenticated()) {
      throw new AuthenticationError('not_authenticated')
    }
  }

  isTokenExpired () {
    this.requireAuthentication()
    const now = +new Date()
    return now > this.credentials.tokenExpiresAt
  }

  authenticate (credentials = null) {
    if (credentials !== null) {
      this.credentials = credentials
    }

    return this.authRequest(
      authenticate(this.options, this.credentials)
        .then(this.handleAuthenticationDone)
        .catch(this.handleAuthenticationError)
    )
  }

  refreshToken () {
    return this.authRequest(
      refreshToken(this.options, this.credentials)
        .then(this.handleAuthenticationDone)
        .catch(error => {
          // When refresh token is (probably) expired, try to authenticate again with current credentials
          const shouldAuthenticate =
            error instanceof AuthenticationError &&
            ['unsupported_grant_type', 'invalid_grant'].includes(error.code)

          if (shouldAuthenticate) {
            return authenticate(this.options, this.credentials)
              .then(this.handleAuthenticationDone)
              .catch(this.handleAuthenticationError)
          }

          return Promise.reject(error)
        })
    )
  }

  authRequest (request) {
    if (!this.__authRequest) {
      this.__authRequest = request
      const cleanup = () => {
        this.__authRequest = null
      }
      this.__authRequest.then(cleanup, cleanup)
    }

    return this.__authRequest
  }

  handleAuthenticationDone (response) {
    const jsonPromise = response.json()

    return jsonPromise.then(data => {
      // Catch auth response errors
      if (!data || data.error) {
        const error = (data && data.error) || 'authentication_failed'
        return Promise.reject(new AuthenticationError(error))
      }

      // TODO: new Date() should be set before calling request and not after
      const tokenExpiresAt = new Date()
      tokenExpiresAt.setSeconds(tokenExpiresAt.getSeconds() + data.expires_in)

      this.credentials = Object.assign(this.credentials, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        tokenExpiresAt: +tokenExpiresAt
      })

      if (typeof this.onAuthenticationSuccess === 'function') {
        this.onAuthenticationSuccess(this.credentials)
      }

      return this.credentials
    })
  }

  handleAuthenticationError (error) {
    if (typeof this.onAuthenticationError === 'function') {
      this.onAuthenticationError(error)
    }

    return Promise.reject(error)
  }
}

module.exports = MasheryClient
module.exports.MasheryClientError = MasheryClientError
module.exports.AuthenticationError = AuthenticationError
module.exports.RequestError = RequestError
