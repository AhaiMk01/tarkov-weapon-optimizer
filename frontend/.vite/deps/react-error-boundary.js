"use client";
import {
  require_react
} from "./chunk-SKCSXP5W.js";
import {
  __toESM
} from "./chunk-DC5AMYBS.js";

// node_modules/react-error-boundary/dist/react-error-boundary.js
var import_react = __toESM(require_react());
var h = (0, import_react.createContext)(null);
var c = {
  didCatch: false,
  error: null
};
var m = class extends import_react.Component {
  constructor(e) {
    super(e), this.resetErrorBoundary = this.resetErrorBoundary.bind(this), this.state = c;
  }
  static getDerivedStateFromError(e) {
    return { didCatch: true, error: e };
  }
  resetErrorBoundary(...e) {
    var _a, _b;
    const { error: t } = this.state;
    t !== null && ((_b = (_a = this.props).onReset) == null ? void 0 : _b.call(_a, {
      args: e,
      reason: "imperative-api"
    }), this.setState(c));
  }
  componentDidCatch(e, t) {
    var _a, _b;
    (_b = (_a = this.props).onError) == null ? void 0 : _b.call(_a, e, t);
  }
  componentDidUpdate(e, t) {
    var _a, _b;
    const { didCatch: o } = this.state, { resetKeys: s } = this.props;
    o && t.error !== null && C(e.resetKeys, s) && ((_b = (_a = this.props).onReset) == null ? void 0 : _b.call(_a, {
      next: s,
      prev: e.resetKeys,
      reason: "keys"
    }), this.setState(c));
  }
  render() {
    const { children: e, fallbackRender: t, FallbackComponent: o, fallback: s } = this.props, { didCatch: n, error: a } = this.state;
    let i = e;
    if (n) {
      const u = {
        error: a,
        resetErrorBoundary: this.resetErrorBoundary
      };
      if (typeof t == "function")
        i = t(u);
      else if (o)
        i = (0, import_react.createElement)(o, u);
      else if (s !== void 0)
        i = s;
      else
        throw a;
    }
    return (0, import_react.createElement)(
      h.Provider,
      {
        value: {
          didCatch: n,
          error: a,
          resetErrorBoundary: this.resetErrorBoundary
        }
      },
      i
    );
  }
};
function C(r = [], e = []) {
  return r.length !== e.length || r.some((t, o) => !Object.is(t, e[o]));
}
function g(r) {
  return r !== null && typeof r == "object" && "didCatch" in r && typeof r.didCatch == "boolean" && "error" in r && "resetErrorBoundary" in r && typeof r.resetErrorBoundary == "function";
}
function x(r) {
  if (!g(r))
    throw new Error("ErrorBoundaryContext not found");
}
function k() {
  const r = (0, import_react.useContext)(h);
  x(r);
  const { error: e, resetErrorBoundary: t } = r, [o, s] = (0, import_react.useState)({
    error: null,
    hasError: false
  }), n = (0, import_react.useMemo)(
    () => ({
      error: e,
      resetBoundary: () => {
        t(), s({ error: null, hasError: false });
      },
      showBoundary: (a) => s({
        error: a,
        hasError: true
      })
    }),
    [e, t]
  );
  if (o.hasError)
    throw o.error;
  return n;
}
function S(r) {
  switch (typeof r) {
    case "object": {
      if (r !== null && "message" in r && typeof r.message == "string")
        return r.message;
      break;
    }
    case "string":
      return r;
  }
}
function w(r, e) {
  const t = (0, import_react.forwardRef)(
    (s, n) => (0, import_react.createElement)(
      m,
      e,
      (0, import_react.createElement)(r, { ...s, ref: n })
    )
  ), o = r.displayName || r.name || "Unknown";
  return t.displayName = `withErrorBoundary(${o})`, t;
}
export {
  m as ErrorBoundary,
  h as ErrorBoundaryContext,
  S as getErrorMessage,
  k as useErrorBoundary,
  w as withErrorBoundary
};
//# sourceMappingURL=react-error-boundary.js.map
