import {wrap} from 'electrode-ota-server-util';
import diregister from "electrode-ota-server-diregister";

export const register = diregister({
    name: 'authRoute',
    dependencies: ['electrode:route', 'ota!account', 'electrode:views', 'ota!scheme', 'ota!logger'],
}, (options, route, acf, views, scheme, logger) => {

    views({
        engines: options.engines || {ejs: require('ejs')},
        relativeTo: options.relativeTo || __dirname,
        path: options.path || '../templates',
        layout: options.layout === false ? false : true
    });

    const {invalidate, addAccessKey, createToken, linkProvider} = wrap({
        invalidate: acf.invalidate,
        addAccessKey: acf.addAccessKey,
        createToken: acf.createToken,
        linkProvider: acf.linkProvider
    });

    route([
        {
            method: 'GET',
            path: '/auth/{type}',
            config: {
                auth: false,
                handler(req, reply){
                    logger.info({ req }, "auth request");
                    reply.view('login', {
                        title: 'Login',
                        providers: options.providers,
                        hostname: req.query.hostname,
                        type: req.params.type
                    });
                }
            }
        }, {
            method: 'GET',
            path: '/accesskey',
            config: {
                auth: {
                    mode: "try",
                    strategy: "session"
                },
                handler({cookieAuth, auth: {isAuthenticated, credentials}} = {
                            auth: {
                                isAuthenticated: false,
                                credentials: {}
                            }
                        }, reply) {

                    if (!isAuthenticated) {
                        return reply.redirect('/auth/login').code(302);
                    }
                    cookieAuth && cookieAuth.clear();
                    reply.view('accesskey', {
                        title: 'Token',
                        name: credentials.name
                    });
                }
            }
        },


        {
            method: 'GET',
            path: '/',
            config: {
                auth: false,
                handler(request, reply){
                    reply.redirect('/auth/login').code(302);
                }
            }
        },
        {
            method: 'GET',
            path: '/authenticated',
            config: {
                auth: {
                    strategy: "bearer",
                    mode: 'try'
                },
                handler(request, reply){
                    reply({
                        "authenticated": request.auth.isAuthenticated
                    });
                }
            }
        }, {
            method: 'GET',
            path: '/logout',
            config: {
                auth: {mode: 'optional', strategies: ['session', 'bearer']},
                handler(request, reply) {
                    invalidate(request.auth.credentials && request.auth.credentials.name, (e) => {
                        if (e) {
                            console.log('error logging out', e);
                        }
                        request.cookieAuth && request.cookieAuth.clear();
                        reply.redirect('/');
                    });
                }
            }
        },
        {
            method: 'DELETE',
            path: '/sessions/{session}',
            config: {
                auth: {mode: 'required'},
                handler(request, reply){
                    invalidate(request.cookieAuth.token, () => {
                        request.cookieAuth.clear();
                        reply();
                    });

                }
            }
        }
    ].concat(
        options.providers.reduce((ret, {
                                      name,
                                      auth,
                                      loginPath,
                                      registerPath,
                                      linkPath,
                                      redirectTo = '/accesskey'
                                  }) => {
            const strategy = auth || name;
            loginPath = loginPath || `/auth/login/${name}`;
            ret.push({
                method: 'GET',
                path: loginPath,
                config: {
                    auth: {
                        mode: "required",
                        strategy
                    },
                    handler ({auth: {isAuthenticated, credentials}, cookieAuth}, reply) {
                        if (!isAuthenticated) {
                            return reply('Not logged in...').code(401);
                        }
                        if (credentials && credentials.profile) {
                            const {email, displayName, username} = credentials.profile;
                            const {hostname} = credentials.query || {};
                            //(email, createdBy, friendlyName, ttl
                            addAccessKey(email, hostname, displayName || username, void(0), (e, token) => {
                                if (e) {
                                    let message = 'Error adding access key';
                                    let href = '';
                                    if (e.message.indexOf('No user registered') >= 0) {
                                        message = e.message + " Try using 'code-push register' instead of 'code-push login', or click here to register.";
                                        href = '/auth/register/' + name;
                                    }
                                    return reply.view('error', {
                                        title: 'Error adding accesskey',
                                        message,
                                        href
                                    });
                                }
                                cookieAuth.set({token: token.name});
                                reply.redirect(redirectTo).code(302);
                            });
                        } else {
                            reply.redirect(redirectTo).code(302);
                        }
                    }
                }
            });
            if (registerPath !== false) {
                registerPath = registerPath || `/auth/register/${name}`;
                ret.push({
                    method: 'GET',
                    path: registerPath,
                    config: {
                        auth: strategy,
                        handler ({auth: {isAuthenticated, credentials}, cookieAuth}, reply) {
                            if (!isAuthenticated) {
                                console.error('request was not authenticated');
                                return reply('Not logged in...').code(401);
                            }

                            createToken(credentials).then((token) => {
                                cookieAuth.set({ token : token.name });
                                reply.redirect(redirectTo).code(302);
                            }).catch((e) => {
                                if (e.output && e.output.payload && e.output.payload.error === 'Conflict') {
                                    return reply.view('error', {
                                        title: 'Error adding account',
                                        message: 'This account is already registered. Click here to log in instead.',
                                        href: `/auth/login?hostname=${credentials.query && credentials.query.hostname}`
                                    })
                                }
                                console.error('Error creating token', e);
                                return reply.view('error', {
                                    title: 'Error adding account',
                                    message: e.message
                                });
                            });
                        }
                    }
                });
                linkPath = linkPath || `/auth/link/${name}`;
                ret.push({
                    method: 'GET',
                    path: linkPath,
                    config: {
                        auth: strategy,
                        handler ({auth: {isAuthenticated, credentials}}, reply) {
                            if (!isAuthenticated) {
                                console.error('request was not authenticated');
                                return reply('Not logged in...').code(401);
                            }
                            if (credentials && credentials.profile) {
                                const {email} = credentials.profile;
                                linkProvider({email, provider: name}, (e) => {
                                    if (e) {
                                        return reply.view('error', {title: 'Error', message: e.message});
                                    }
                                    reply.view('link', {
                                        title: `Linked to ${name}`,
                                        provider: name
                                    });
                                });
                            }
                        }
                    }
                });
            }
            return ret;

        }, [])));

});

export default({register});
