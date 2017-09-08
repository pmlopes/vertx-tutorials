# Basics of Authentication

In this section, we're going to focus on the basics of authentication. Specifically, we're going to create a Java server (using [vert.x](http://vertx.io)) that implements the [web flow](https://developer.github.com/apps/building-integrations/setting-up-and-registering-oauth-apps/about-authorization-options-for-oauth-apps/) of an application in several different ways.

!!! note
    You can download the complete source code for this project from the [vertx-examples](https://github.com/vert-x3/vertx-examples) repo.

## Registering your app

First, you'll need to [register your application](https://github.com/settings/applications/new). Every registered OAuth application is assigned a unique Client ID and Client Secret. The Client Secret should not be shared! That includes checking the string into your repository.

You can fill out every piece of information however you like, except the **Authorization callback URL**. This is easily the most important piece to setting up your application. It's the callback URL that GitHub returns the user to after successful authentication.

Since we're running a regular Sinatra server, the location of the local instance is set to `http://localhost:8080`. Let's fill in the callback URL as `http://localhost:8080/callback`.

## Accepting user authorization

Now, let's start filling out our simple server. Create a class called `io.acme.Server` and paste this into it:

```java
package io.acme;

import io.vertx.core.AbstractVerticle;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.auth.oauth2.*;
import io.vertx.ext.auth.oauth2.providers.GithubAuth;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.handler.*;
import io.vertx.ext.web.templ.HandlebarsTemplateEngine;

public class Server extends AbstractVerticle {

  private static final String CLIENT_ID =
    System.getEnv("GITHUB_CLIENT_ID");
  private static final String CLIENT_SECRET =
    System.getEnv("GITHUB_CLIENT_SECRET");

  // In order to use a template we first need to
  // create an engine
  private final HandlebarsTemplateEngine engine =
    HandlebarsTemplateEngine.create();

  @Override
  public void start() throws Exception {
    // To simplify the development of the web components
    // we use a Router to route all HTTP requests
    // to organize our code in a reusable way.
    final Router router = Router.router(vertx);
    // we now protect the resource under the path "/protected"
    router.route("/protected").handler(
      OAuth2AuthHandler.create(authProvider)
        // for this resource we require that users have
        // the authority to retrieve the user emails
        .addAuthority("user:email")
    );
    // Entry point to the application, this will render
    // a custom template.
    router.get("/").handler(ctx -> {
      // we pass the client id to the template
      ctx.put("client_id", CLIENT_ID);
      // and now delegate to the engine to render it.
      engine.render(ctx, "views", "/index.hbs", res -> {
        if (res.succeeded()) {
          ctx.response()
            .putHeader("Content-Type", "text/html")
            .end(res.result());
        } else {
          ctx.fail(res.cause());
        }
      });
    });
    // The protected resource
    router.get("/protected").handler(ctx -> {
      ctx.response()
        .end("Hello protected!");
    });

    vertx.createHttpServer()
      .requestHandler(router::accept)
      .listen(8080);
  }
}
```

Your client ID and client secret keys come from [your application's configuration page](https://github.com/settings/developers). You should **never, ever** store these values in GitHub--or any other public place, for that matter. We recommend storing them as [environment variables](http://en.wikipedia.org/wiki/Environment_variable#Getting_and_setting_environment_variables) -- which is exactly what we've done here.

Notice that the protected resource uses the scope `user:email` to define the scopes requested by the application. For our application, we're requesting `user:email` scope for reading private email addresses.

Next, in the *project resources* create the template `views/index.hbs` and paste this content:

```html
<html>
  <body>
    <p>
      Well, hello there!
    </p>
    <p>
      We're going to the protected resource, if there is no
      user in the session we will talk to the GitHub API. Ready?
      <a href="/protected">Click here</a> to begin!</a>
    </p>
    <p>
      <b>If that link doesn't work</b>, remember to provide
      your own <a href="https://github.com/settings/applications/new">
      Client ID</a>!
    </p>
  </body>
</html>
```

(If you're unfamiliar with how [Handlebars](http://handlebarsjs.com/) works, we recommend reading the [Handlebars](http://handlebarsjs.com/) guide.)

Navigate your browser to [http://localhost:8080](http://localhost:8080). After clicking on the link, you should be taken to GitHub, and presented with a dialog that looks something like this:

![](./images/oauth_prompt.png)

If you trust yourself, click **Authorize App**. Wuh-oh! Vert.x spits out a 500 error (with the message `callback route is not configured`). What gives?!

Well, remember when we specified a Callback URL to be `callback`? We didn't provide a route for it, so GitHub doesn't know where to drop the user after they authorize the app. Let's fix that now!

### Providing a callback

In the `Server` class you don't need to know the internal of the OAuth2 protocol, the `OAuth2AuthHandler` can do it for if you configure the protection as:

```java
router.route("/protected").handler(
  OAuth2AuthHandler.create(authProvider)
    // we now configure the oauth2 handler,
    // it will setup the callback handler
    // as expected by your oauth2 provider.
    .setupCallback(router.route("/callback"))
    // for this resource we require that
    // users have the authority to retrieve
    // the user emails
    .addAuthority("user:email"));
```

After a successful app authentication, GitHub provides a temporary `code` value. This code is then `POST`ed back to GitHub in exchange for an `access_token` which is in turn translated to a `User` instance in your vert.x application. All this is taken care for you by the handler.

### Checking granted scopes

Before the `User` object is handled to you, if your handler was configured with `authorities` they will be first checked. If they are not present then they the whole process is aborted with an `Authorization` error.

However you might want to assert for other granted authorities, in this case you would:

```java
ctx.user()
  .isAuthorised("some:authority", res -> {
    if (res.failed()) {
      // some error handling here...
    } else {
      if (res.result()) {
        // is authorized!
      } else {
        // is not authorized!
      }
    }
  });
```

### Making authenticated request

At last, with this access token, you'll be able to make authenticated requests as the logged in user:

```java
// we cast the user to a specialized implementation
AccessToken user = (AccessToken) ctx.user();
// retrieve the user profile, this is a common feature
// but not from the official OAuth2 spec
user.userInfo(res -> {
  if (res.failed()) {
    // request didn't succeed because the token was revoked so we
    // invalidate the token stored in the session and render the
    // index page so that the user can start the OAuth flow again
    ctx.session().destroy();
    ctx.fail(res.cause());
    return;
  }

  // the request succeeded, so we use the API to fetch the user's emails
  final JsonObject userInfo = res.result();

  // fetch the user emails from the github API

  // the fetch method will retrieve any resource and ensure the right
  // secure headers are passed.
  user.fetch("https://api.github.com/user/emails", res2 -> {
    if (res2.failed()) {
      ctx.session().destroy();
      ctx.fail(res.cause());
      return;
    }

    userInfo.put("private_emails", res2.result().jsonArray());
    // we pass the client info to the template
    ctx.put("userInfo", userInfo);
    // and now delegate to the engine to render it.
    engine.render(ctx, "views", "/advanced.hbs", res3 -> {
      if (res3.succeeded()) {
        ctx.response()
          .putHeader("Content-Type", "text/html")
          .end(res3.result());
      } else {
        ctx.fail(res3.cause());
      }
    });
  });
});
```

We can do whatever we want with our results. In this case, we'll just dump them straight into `advanced.hbs`:

```html+handlebars
<html>
<body>
<p>Well, well, well, {{userInfo.login}}!</p>
<p>
  {{#if userInfo.email}} It looks like your public email
  address is {{userInfo.email}}.
  {{else}} It looks like you don't have a public email.
  That's cool.
  {{/if}}
</p>
<p>
  {{#if userInfo.private_emails}}
  With your permission, we were also able to dig up your
  private email addresses:
  {{#each userInfo.private_emails}}
    {{email}}{{#unless @last}},{{/unless}}
  {{/each}}
  {{else}}
  Also, you're a bit secretive about your private email
  addresses.
  {{/if}}
</p>
</body>
</html>
```

## Implementing "persistent" authentication

It'd be a pretty bad model if we required users to log into the app every single time they needed to access the web page. For example, try navigating directly to `http://localhost:8080/protected`. You'll get an authentication request over and over.

What if we could circumvent the entire "click here" process, and just remember that, as long as the user's logged into GitHub, they should be able to access this application? Hold on to your hat, because that's *exactly what we're going to do*.

Our little server above is rather simple. In order to wedge in some intelligent authentication, we're going to switch over to using sessions for storing tokens. This will make authentication transparent to the user.

This can be achived with the stock handlers so our server file would be:

```java
package io.acme;

import io.vertx.core.AbstractVerticle;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.auth.oauth2.AccessToken;
import io.vertx.ext.auth.oauth2.OAuth2Auth;
import io.vertx.ext.auth.oauth2.providers.GithubAuth;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.handler.*;
import io.vertx.ext.web.sstore.LocalSessionStore;
import io.vertx.ext.web.templ.HandlebarsTemplateEngine;

public class Server extends AbstractVerticle {

  private static final String CLIENT_ID =
    System.getEnv("GITHUB_CLIENT_ID");
  private static final String CLIENT_SECRET =
    System.getEnv("GITHUB_CLIENT_SECRET");

  // In order to use a template we first need to
  // create an engine
  private final HandlebarsTemplateEngine engine =
    HandlebarsTemplateEngine.create();

  @Override
  public void start() throws Exception {
    // To simplify the development of the web components
    // we use a Router to route all HTTP requests
    // to organize our code in a reusable way.
    final Router router = Router.router(vertx);
    // We need cookies and sessions
    router.route()
      .handler(CookieHandler.create());
    router.route()
      .handler(SessionHandler.create(LocalSessionStore.create(vertx)));
    // Simple auth service which uses a GitHub to
    // authenticate the user
    OAuth2Auth authProvider =
      GithubAuth.create(vertx, CLIENT_ID, CLIENT_SECRET);
    // We need a user session handler too to make sure
    // the user is stored in the session between requests
    router.route()
      .handler(UserSessionHandler.create(authProvider));
    // we now protect the resource under the path "/protected"
    router.route("/protected").handler(
      OAuth2AuthHandler.create(authProvider)
        // we now configure the oauth2 handler, it will
        // setup the callback handler
        // as expected by your oauth2 provider.
        .setupCallback(router.route("/callback"))
        // for this resource we require that users have
        // the authority to retrieve the user emails
        .addAuthority("user:email")
    );
    // Entry point to the application, this will render
    // a custom template.
    router.get("/").handler(ctx -> {
      // we pass the client id to the template
      ctx.put("client_id", CLIENT_ID);
      // and now delegate to the engine to render it.
      engine.render(ctx, "views", "/index.hbs", res -> {
        if (res.succeeded()) {
          ctx.response()
            .putHeader("Content-Type", "text/html")
            .end(res.result());
        } else {
          ctx.fail(res.cause());
        }
      });
    });
    // The protected resource
    router.get("/protected").handler(ctx -> {
      AccessToken user = (AccessToken) ctx.user();
      // retrieve the user profile, this is a common
      // feature but not from the official OAuth2 spec
      user.userInfo(res -> {
        if (res.failed()) {
          // request didn't succeed because the token
          // was revoked so we invalidate the token stored
          // in the session and render an error page
          // so that the user can start the OAuth flow again
          ctx.session().destroy();
          ctx.fail(res.cause());
        } else {
          // the request succeeded, so we use the API to
          // fetch the user's emails
          final JsonObject userInfo = res.result();

          // fetch the user emails from the github API

          // the fetch method will retrieve any resource and
          // ensure the right secure headers are passed.
          user.fetch("https://api.github.com/user/emails", res2 -> {
            if (res2.failed()) {
              // request didn't succeed because the token
              // was revoked so we invalidate the token stored
              // in the session and render an error page
              // so that the user can start the OAuth flow again
              ctx.session().destroy();
              ctx.fail(res2.cause());
            } else {
              userInfo.put("private_emails", res2.result().jsonArray());
              // we pass the client info to the template
              ctx.put("userInfo", userInfo);
              // and now delegate to the engine to render it.
              engine.render(ctx, "views", "/advanced.hbs", res3 -> {
                if (res3.succeeded()) {
                  ctx.response()
                    .putHeader("Content-Type", "text/html")
                    .end(res3.result());
                } else {
                  ctx.fail(res3.cause());
                }
              });
            }
          });
        }
      });
    });

    vertx.createHttpServer().requestHandler(router::accept).listen(8080);
  }
}
```

I hope you now can use OAuth2 on your next project!