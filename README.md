# Clojurific #

ClojureScript compiled to ES modules, bundled by Vite.

Clojurific is a fork of [ClojureScript](https://github.com/clojure/clojurescript)
by [Whimsical](https://whimsical.com). Its `:module-format :esm` compiles every
namespace to an ES module and leaves bundling, minification, npm packages and
TypeScript to Vite, without the Google Closure Compiler. It includes a Vite
plugin, hot reloading and an nREPL server evaluating in the browser. See
[ESM.md](ESM.md) for usage, design and known gaps. The classic compiler
(`cljs.main`, `cljs.build.api`) is still there and needs the Closure Compiler,
see [Dependencies](ESM.md#dependencies).

It's based on ClojureScript 1.12.145 and keeps its namespaces (`cljs.core`,
`cljs.analyzer`, …), so libraries written for ClojureScript work unchanged.
Status: experimental.

Versions are `0.<minor>.<release>`: `<minor>` is the ClojureScript 1.x release
it's compatible with (12 for 1.12.x), `<release>` counts Clojurific's releases,
starting from 1.

## Dependency information ##

[Clojure deps.edn](https://clojure.org/guides/deps_and_cli), as a git
dependency:

```clojure
com.whimsical/clojurific {:git/url "https://github.com/WhimsicalCode/clojurific"
                          :git/sha "…"}
```

Stock ClojureScript (`org.clojure/clojurescript`) has the same namespaces, so
it mustn't be on the classpath too: `cljs.esm` fails at startup, naming both,
when it is. Exclude it from the library that brings it in with
`:exclusions [org.clojure/clojurescript]`, or from the whole dependency tree
with the empty project in `no-clojurescript/`:

```clojure
:override-deps {org.clojure/clojurescript {:git/url "https://github.com/WhimsicalCode/clojurific"
                                           :git/sha "…"
                                           :deps/root "no-clojurescript"}}
```

The rest of this README is upstream's, about ClojureScript itself. Report
problems with the fork's additions (`cljs.esm`, the Vite plugin) to
[WhimsicalCode/clojurific](https://github.com/WhimsicalCode/clojurific)
instead.

## Getting Started ##

* Read the [Quick Start](https://clojurescript.org/guides/quick-start) guide.
* Read the [Documentation](https://clojurescript.org).
* Try a [tutorial](https://clojurescript.org/guides).
* [Companies using ClojureScript](https://clojurescript.org/community/companies)

## Questions, Feedback? ##

Please point all of your questions and feedback to the
[Clojure mailing list](https://groups.google.com/group/clojure). There
is a community run
[ClojureScript user mailing list](https://groups.google.com/group/clojurescript) and
the IRC channel, `#clojurescript` on [freenode.net](https://freenode.net/), is quite active.
There is also a community run [Slack channel](https://clojurians.slack.com). The
Jira bug/feature tracking application is located at
<https://clojure.atlassian.net/browse/CLJS>. Before submitting issues
please read the
[Reporting Issues](https://github.com/clojure/clojurescript/wiki/Reporting-Issues)
page first.

## Developers Welcome ##

ClojureScript operates under the same license as Clojure. All
contributors must have a signed CA (Contributor's Agreement) and
submit their patch via the appropriate channels. If you're interested
in contributing to the project, please see the
[contributing](https://clojure.org/dev/contributing) page on
[clojure.org](https://clojure.org). For more information about working
on the compiler and testing check the
[Developer section of the wiki](https://github.com/clojure/clojurescript/wiki/Developers).

YourKit
----

<img src="https://www.yourkit.com/images/yklogo.png"></img>

YourKit has given an open source license for their profiler, greatly simplifying the profiling of ClojureScript performance.

YourKit supports open source projects with its full-featured Java Profiler.
YourKit, LLC is the creator of <a href="https://www.yourkit.com/java/profiler/index.jsp">YourKit Java Profiler</a>
and <a href="https://www.yourkit.com/.net/profiler/index.jsp">YourKit .NET Profiler</a>,
innovative and intelligent tools for profiling Java and .NET applications.

## License ##

    Copyright (c) Rich Hickey. All rights reserved. The use and
    distribution terms for this software are covered by the Eclipse
    Public License 1.0 (https://opensource.org/license/epl-1-0/)
    which can be found in the file epl-v10.html at the root of this
    distribution. By using this software in any fashion, you are
    agreeing to be bound by the terms of this license. You must
    not remove this notice, or any other, from this software.
