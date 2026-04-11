import {
  require_shim
} from "./chunk-WXPUGGPP.js";
import {
  require_react
} from "./chunk-SKCSXP5W.js";
import {
  keysFromSelector
} from "./chunk-U4B3EOPV.js";
import {
  __commonJS,
  __toESM
} from "./chunk-DC5AMYBS.js";

// node_modules/void-elements/index.js
var require_void_elements = __commonJS({
  "node_modules/void-elements/index.js"(exports, module) {
    module.exports = {
      "area": true,
      "base": true,
      "br": true,
      "col": true,
      "embed": true,
      "hr": true,
      "img": true,
      "input": true,
      "link": true,
      "meta": true,
      "param": true,
      "source": true,
      "track": true,
      "wbr": true
    };
  }
});

// node_modules/react-i18next/dist/es/Trans.js
var import_react3 = __toESM(require_react(), 1);

// node_modules/react-i18next/dist/es/TransWithoutContext.js
var import_react = __toESM(require_react(), 1);

// node_modules/html-parse-stringify/dist/html-parse-stringify.module.js
var import_void_elements = __toESM(require_void_elements());
var t = /\s([^'"/\s><]+?)[\s/>]|([^\s=]+)=\s?(".*?"|'.*?')/g;
function n(n2) {
  var r2 = { type: "tag", name: "", voidElement: false, attrs: {}, children: [] }, i2 = n2.match(/<\/?([^\s]+?)[/\s>]/);
  if (i2 && (r2.name = i2[1], (import_void_elements.default[i2[1]] || "/" === n2.charAt(n2.length - 2)) && (r2.voidElement = true), r2.name.startsWith("!--"))) {
    var s2 = n2.indexOf("-->");
    return { type: "comment", comment: -1 !== s2 ? n2.slice(4, s2) : "" };
  }
  for (var a2 = new RegExp(t), c2 = null; null !== (c2 = a2.exec(n2)); ) if (c2[0].trim()) if (c2[1]) {
    var o = c2[1].trim(), l = [o, ""];
    o.indexOf("=") > -1 && (l = o.split("=")), r2.attrs[l[0]] = l[1], a2.lastIndex--;
  } else c2[2] && (r2.attrs[c2[2]] = c2[3].trim().substring(1, c2[3].length - 1));
  return r2;
}
var r = /<[a-zA-Z0-9\-\!\/](?:"[^"]*"|'[^']*'|[^'">])*>/g;
var i = /^\s*$/;
var s = /* @__PURE__ */ Object.create(null);
function a(e2, t2) {
  switch (t2.type) {
    case "text":
      return e2 + t2.content;
    case "tag":
      return e2 += "<" + t2.name + (t2.attrs ? (function(e3) {
        var t3 = [];
        for (var n2 in e3) t3.push(n2 + '="' + e3[n2] + '"');
        return t3.length ? " " + t3.join(" ") : "";
      })(t2.attrs) : "") + (t2.voidElement ? "/>" : ">"), t2.voidElement ? e2 : e2 + t2.children.reduce(a, "") + "</" + t2.name + ">";
    case "comment":
      return e2 + "<!--" + t2.comment + "-->";
  }
}
var c = { parse: function(e2, t2) {
  t2 || (t2 = {}), t2.components || (t2.components = s);
  var a2, c2 = [], o = [], l = -1, m = false;
  if (0 !== e2.indexOf("<")) {
    var u = e2.indexOf("<");
    c2.push({ type: "text", content: -1 === u ? e2 : e2.substring(0, u) });
  }
  return e2.replace(r, function(r2, s2) {
    if (m) {
      if (r2 !== "</" + a2.name + ">") return;
      m = false;
    }
    var u2, f = "/" !== r2.charAt(1), h = r2.startsWith("<!--"), p = s2 + r2.length, d = e2.charAt(p);
    if (h) {
      var v = n(r2);
      return l < 0 ? (c2.push(v), c2) : ((u2 = o[l]).children.push(v), c2);
    }
    if (f && (l++, "tag" === (a2 = n(r2)).type && t2.components[a2.name] && (a2.type = "component", m = true), a2.voidElement || m || !d || "<" === d || a2.children.push({ type: "text", content: e2.slice(p, e2.indexOf("<", p)) }), 0 === l && c2.push(a2), (u2 = o[l - 1]) && u2.children.push(a2), o[l] = a2), (!f || a2.voidElement) && (l > -1 && (a2.voidElement || a2.name === r2.slice(2, -1)) && (l--, a2 = -1 === l ? c2 : o[l]), !m && "<" !== d && d)) {
      u2 = -1 === l ? c2 : o[l].children;
      var x = e2.indexOf("<", p), g = e2.slice(p, -1 === x ? void 0 : x);
      i.test(g) && (g = " "), (x > -1 && l + u2.length >= 0 || " " !== g) && u2.push({ type: "text", content: g });
    }
  }), c2;
}, stringify: function(e2) {
  return e2.reduce(function(e3, t2) {
    return e3 + a("", t2);
  }, "");
} };
var html_parse_stringify_module_default = c;

// node_modules/react-i18next/dist/es/utils.js
var warn = (i18n, code, msg, rest) => {
  var _a, _b, _c, _d;
  const args = [msg, {
    code,
    ...rest || {}
  }];
  if ((_b = (_a = i18n == null ? void 0 : i18n.services) == null ? void 0 : _a.logger) == null ? void 0 : _b.forward) {
    return i18n.services.logger.forward(args, "warn", "react-i18next::", true);
  }
  if (isString(args[0])) args[0] = `react-i18next:: ${args[0]}`;
  if ((_d = (_c = i18n == null ? void 0 : i18n.services) == null ? void 0 : _c.logger) == null ? void 0 : _d.warn) {
    i18n.services.logger.warn(...args);
  } else if (console == null ? void 0 : console.warn) {
    console.warn(...args);
  }
};
var alreadyWarned = {};
var warnOnce = (i18n, code, msg, rest) => {
  if (isString(msg) && alreadyWarned[msg]) return;
  if (isString(msg)) alreadyWarned[msg] = /* @__PURE__ */ new Date();
  warn(i18n, code, msg, rest);
};
var loadedClb = (i18n, cb) => () => {
  if (i18n.isInitialized) {
    cb();
  } else {
    const initialized = () => {
      setTimeout(() => {
        i18n.off("initialized", initialized);
      }, 0);
      cb();
    };
    i18n.on("initialized", initialized);
  }
};
var loadNamespaces = (i18n, ns, cb) => {
  i18n.loadNamespaces(ns, loadedClb(i18n, cb));
};
var loadLanguages = (i18n, lng, ns, cb) => {
  if (isString(ns)) ns = [ns];
  if (i18n.options.preload && i18n.options.preload.indexOf(lng) > -1) return loadNamespaces(i18n, ns, cb);
  ns.forEach((n2) => {
    if (i18n.options.ns.indexOf(n2) < 0) i18n.options.ns.push(n2);
  });
  i18n.loadLanguages(lng, loadedClb(i18n, cb));
};
var hasLoadedNamespace = (ns, i18n, options = {}) => {
  if (!i18n.languages || !i18n.languages.length) {
    warnOnce(i18n, "NO_LANGUAGES", "i18n.languages were undefined or empty", {
      languages: i18n.languages
    });
    return true;
  }
  return i18n.hasLoadedNamespace(ns, {
    lng: options.lng,
    precheck: (i18nInstance2, loadNotPending) => {
      if (options.bindI18n && options.bindI18n.indexOf("languageChanging") > -1 && i18nInstance2.services.backendConnector.backend && i18nInstance2.isLanguageChangingTo && !loadNotPending(i18nInstance2.isLanguageChangingTo, ns)) return false;
    }
  });
};
var getDisplayName = (Component) => Component.displayName || Component.name || (isString(Component) && Component.length > 0 ? Component : "Unknown");
var isString = (obj) => typeof obj === "string";
var isObject = (obj) => typeof obj === "object" && obj !== null;

// node_modules/react-i18next/dist/es/unescape.js
var matchHtmlEntity = /&(?:amp|#38|lt|#60|gt|#62|apos|#39|quot|#34|nbsp|#160|copy|#169|reg|#174|hellip|#8230|#x2F|#47);/g;
var htmlEntities = {
  "&amp;": "&",
  "&#38;": "&",
  "&lt;": "<",
  "&#60;": "<",
  "&gt;": ">",
  "&#62;": ">",
  "&apos;": "'",
  "&#39;": "'",
  "&quot;": '"',
  "&#34;": '"',
  "&nbsp;": " ",
  "&#160;": " ",
  "&copy;": "©",
  "&#169;": "©",
  "&reg;": "®",
  "&#174;": "®",
  "&hellip;": "…",
  "&#8230;": "…",
  "&#x2F;": "/",
  "&#47;": "/"
};
var unescapeHtmlEntity = (m) => htmlEntities[m];
var unescape = (text) => text.replace(matchHtmlEntity, unescapeHtmlEntity);

// node_modules/react-i18next/dist/es/defaults.js
var defaultOptions = {
  bindI18n: "languageChanged",
  bindI18nStore: "",
  transEmptyNodeValue: "",
  transSupportBasicHtmlNodes: true,
  transWrapTextNodes: "",
  transKeepBasicHtmlNodesFor: ["br", "strong", "i", "p"],
  useSuspense: true,
  unescape,
  transDefaultProps: void 0
};
var setDefaults = (options = {}) => {
  defaultOptions = {
    ...defaultOptions,
    ...options
  };
};
var getDefaults = () => defaultOptions;

// node_modules/react-i18next/dist/es/i18nInstance.js
var i18nInstance;
var setI18n = (instance) => {
  i18nInstance = instance;
};
var getI18n = () => i18nInstance;

// node_modules/react-i18next/dist/es/TransWithoutContext.js
var hasChildren = (node, checkLength) => {
  var _a;
  if (!node) return false;
  const base = ((_a = node.props) == null ? void 0 : _a.children) ?? node.children;
  if (checkLength) return base.length > 0;
  return !!base;
};
var getChildren = (node) => {
  var _a, _b;
  if (!node) return [];
  const children = ((_a = node.props) == null ? void 0 : _a.children) ?? node.children;
  return ((_b = node.props) == null ? void 0 : _b.i18nIsDynamicList) ? getAsArray(children) : children;
};
var hasValidReactChildren = (children) => Array.isArray(children) && children.every(import_react.isValidElement);
var getAsArray = (data) => Array.isArray(data) ? data : [data];
var mergeProps = (source, target) => {
  const newTarget = {
    ...target
  };
  newTarget.props = {
    ...target.props,
    ...source.props
  };
  return newTarget;
};
var getValuesFromChildren = (children) => {
  const values = {};
  if (!children) return values;
  const getData = (childs) => {
    const childrenArray = getAsArray(childs);
    childrenArray.forEach((child) => {
      if (isString(child)) return;
      if (hasChildren(child)) getData(getChildren(child));
      else if (isObject(child) && !(0, import_react.isValidElement)(child)) Object.assign(values, child);
    });
  };
  getData(children);
  return values;
};
var nodesToString = (children, i18nOptions, i18n, i18nKey) => {
  if (!children) return "";
  let stringNode = "";
  const childrenArray = getAsArray(children);
  const keepArray = (i18nOptions == null ? void 0 : i18nOptions.transSupportBasicHtmlNodes) ? i18nOptions.transKeepBasicHtmlNodesFor ?? [] : [];
  childrenArray.forEach((child, childIndex) => {
    if (isString(child)) {
      stringNode += `${child}`;
      return;
    }
    if ((0, import_react.isValidElement)(child)) {
      const {
        props,
        type
      } = child;
      const childPropsCount = Object.keys(props).length;
      const shouldKeepChild = keepArray.indexOf(type) > -1;
      const childChildren = props.children;
      if (!childChildren && shouldKeepChild && !childPropsCount) {
        stringNode += `<${type}/>`;
        return;
      }
      if (!childChildren && (!shouldKeepChild || childPropsCount) || props.i18nIsDynamicList) {
        stringNode += `<${childIndex}></${childIndex}>`;
        return;
      }
      if (shouldKeepChild && childPropsCount === 1 && isString(childChildren)) {
        stringNode += `<${type}>${childChildren}</${type}>`;
        return;
      }
      const content = nodesToString(childChildren, i18nOptions, i18n, i18nKey);
      stringNode += `<${childIndex}>${content}</${childIndex}>`;
      return;
    }
    if (child === null) {
      warn(i18n, "TRANS_NULL_VALUE", `Passed in a null value as child`, {
        i18nKey
      });
      return;
    }
    if (isObject(child)) {
      const {
        format,
        ...clone
      } = child;
      const keys = Object.keys(clone);
      if (keys.length === 1) {
        const value = format ? `${keys[0]}, ${format}` : keys[0];
        stringNode += `{{${value}}}`;
        return;
      }
      warn(i18n, "TRANS_INVALID_OBJ", `Invalid child - Object should only have keys {{ value, format }} (format is optional).`, {
        i18nKey,
        child
      });
      return;
    }
    warn(i18n, "TRANS_INVALID_VAR", `Passed in a variable like {number} - pass variables for interpolation as full objects like {{number}}.`, {
      i18nKey,
      child
    });
  });
  return stringNode;
};
var escapeLiteralLessThan = (str, keepArray = [], knownComponentsMap = {}) => {
  if (!str) return str;
  const knownNames = Object.keys(knownComponentsMap);
  const allValidNames = [...keepArray, ...knownNames];
  let result = "";
  let i2 = 0;
  while (i2 < str.length) {
    if (str[i2] === "<") {
      let isValidTag = false;
      const closingMatch = str.slice(i2).match(/^<\/(\d+|[a-zA-Z][a-zA-Z0-9_-]*)>/);
      if (closingMatch) {
        const tagName = closingMatch[1];
        if (/^\d+$/.test(tagName) || allValidNames.includes(tagName)) {
          isValidTag = true;
          result += closingMatch[0];
          i2 += closingMatch[0].length;
        }
      }
      if (!isValidTag) {
        const openingMatch = str.slice(i2).match(/^<(\d+|[a-zA-Z][a-zA-Z0-9_-]*)(\s+[\w-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*(\/)?>/);
        if (openingMatch) {
          const tagName = openingMatch[1];
          if (/^\d+$/.test(tagName) || allValidNames.includes(tagName)) {
            isValidTag = true;
            result += openingMatch[0];
            i2 += openingMatch[0].length;
          }
        }
      }
      if (!isValidTag) {
        result += "&lt;";
        i2 += 1;
      }
    } else {
      result += str[i2];
      i2 += 1;
    }
  }
  return result;
};
var renderNodes = (children, knownComponentsMap, targetString, i18n, i18nOptions, combinedTOpts, shouldUnescape) => {
  if (targetString === "") return [];
  const keepArray = i18nOptions.transKeepBasicHtmlNodesFor || [];
  const emptyChildrenButNeedsHandling = targetString && new RegExp(keepArray.map((keep) => `<${keep}`).join("|")).test(targetString);
  if (!children && !knownComponentsMap && !emptyChildrenButNeedsHandling && !shouldUnescape) return [targetString];
  const data = knownComponentsMap ?? {};
  const getData = (childs) => {
    const childrenArray = getAsArray(childs);
    childrenArray.forEach((child) => {
      if (isString(child)) return;
      if (hasChildren(child)) getData(getChildren(child));
      else if (isObject(child) && !(0, import_react.isValidElement)(child)) Object.assign(data, child);
    });
  };
  getData(children);
  const escapedString = escapeLiteralLessThan(targetString, keepArray, data);
  const ast = html_parse_stringify_module_default.parse(`<0>${escapedString}</0>`);
  const opts = {
    ...data,
    ...combinedTOpts
  };
  const renderInner = (child, node, rootReactNode) => {
    var _a;
    const childs = getChildren(child);
    const mappedChildren = mapAST(childs, node.children, rootReactNode);
    return hasValidReactChildren(childs) && mappedChildren.length === 0 || ((_a = child.props) == null ? void 0 : _a.i18nIsDynamicList) ? childs : mappedChildren;
  };
  const pushTranslatedJSX = (child, inner, mem, i2, isVoid) => {
    if (child.dummy) {
      child.children = inner;
      mem.push((0, import_react.cloneElement)(child, {
        key: i2
      }, isVoid ? void 0 : inner));
    } else {
      mem.push(...import_react.Children.map([child], (c2) => {
        const INTERNAL_DYNAMIC_MARKER = "data-i18n-is-dynamic-list";
        const override = {
          key: i2,
          [INTERNAL_DYNAMIC_MARKER]: void 0
        };
        if (c2 && c2.props) {
          Object.keys(c2.props).forEach((k) => {
            if (k === "ref" || k === "children" || k === "i18nIsDynamicList" || k === INTERNAL_DYNAMIC_MARKER) return;
            override[k] = c2.props[k];
          });
        }
        return (0, import_react.cloneElement)(c2, override, isVoid ? null : inner);
      }));
    }
  };
  const mapAST = (reactNode, astNode, rootReactNode) => {
    const reactNodes = getAsArray(reactNode);
    const astNodes = getAsArray(astNode);
    return astNodes.reduce((mem, node, i2) => {
      var _a, _b;
      const translationContent = ((_b = (_a = node.children) == null ? void 0 : _a[0]) == null ? void 0 : _b.content) && i18n.services.interpolator.interpolate(node.children[0].content, opts, i18n.language);
      if (node.type === "tag") {
        let tmp = reactNodes[parseInt(node.name, 10)];
        if (!tmp && knownComponentsMap) tmp = knownComponentsMap[node.name];
        if (rootReactNode.length === 1 && !tmp) tmp = rootReactNode[0][node.name];
        if (!tmp) tmp = {};
        const props = {
          ...node.attrs
        };
        if (shouldUnescape) {
          Object.keys(props).forEach((p) => {
            const val = props[p];
            if (isString(val)) {
              props[p] = unescape(val);
            }
          });
        }
        const child = Object.keys(props).length !== 0 ? mergeProps({
          props
        }, tmp) : tmp;
        const isElement = (0, import_react.isValidElement)(child);
        const isValidTranslationWithChildren = isElement && hasChildren(node, true) && !node.voidElement;
        const isEmptyTransWithHTML = emptyChildrenButNeedsHandling && isObject(child) && child.dummy && !isElement;
        const isKnownComponent = isObject(knownComponentsMap) && Object.hasOwnProperty.call(knownComponentsMap, node.name);
        if (isString(child)) {
          const value = i18n.services.interpolator.interpolate(child, opts, i18n.language);
          mem.push(value);
        } else if (hasChildren(child) || isValidTranslationWithChildren) {
          const inner = renderInner(child, node, rootReactNode);
          pushTranslatedJSX(child, inner, mem, i2);
        } else if (isEmptyTransWithHTML) {
          const inner = mapAST(reactNodes, node.children, rootReactNode);
          pushTranslatedJSX(child, inner, mem, i2);
        } else if (Number.isNaN(parseFloat(node.name))) {
          if (isKnownComponent) {
            const inner = renderInner(child, node, rootReactNode);
            pushTranslatedJSX(child, inner, mem, i2, node.voidElement);
          } else if (i18nOptions.transSupportBasicHtmlNodes && keepArray.indexOf(node.name) > -1) {
            if (node.voidElement) {
              mem.push((0, import_react.createElement)(node.name, {
                key: `${node.name}-${i2}`
              }));
            } else {
              const inner = mapAST(reactNodes, node.children, rootReactNode);
              mem.push((0, import_react.createElement)(node.name, {
                key: `${node.name}-${i2}`
              }, inner));
            }
          } else if (node.voidElement) {
            mem.push(`<${node.name} />`);
          } else {
            const inner = mapAST(reactNodes, node.children, rootReactNode);
            mem.push(`<${node.name}>${inner}</${node.name}>`);
          }
        } else if (isObject(child) && !isElement) {
          const content = node.children[0] ? translationContent : null;
          if (content) mem.push(content);
        } else {
          pushTranslatedJSX(child, translationContent, mem, i2, node.children.length !== 1 || !translationContent);
        }
      } else if (node.type === "text") {
        const wrapTextNodes = i18nOptions.transWrapTextNodes;
        const unescapeFn = typeof i18nOptions.unescape === "function" ? i18nOptions.unescape : getDefaults().unescape;
        const content = shouldUnescape ? unescapeFn(i18n.services.interpolator.interpolate(node.content, opts, i18n.language)) : i18n.services.interpolator.interpolate(node.content, opts, i18n.language);
        if (wrapTextNodes) {
          mem.push((0, import_react.createElement)(wrapTextNodes, {
            key: `${node.name}-${i2}`
          }, content));
        } else {
          mem.push(content);
        }
      }
      return mem;
    }, []);
  };
  const result = mapAST([{
    dummy: true,
    children: children || []
  }], ast, getAsArray(children || []));
  return getChildren(result[0]);
};
var fixComponentProps = (component, index, translation) => {
  const componentKey = component.key || index;
  const comp = (0, import_react.cloneElement)(component, {
    key: componentKey
  });
  if (!comp.props || !comp.props.children || translation.indexOf(`${index}/>`) < 0 && translation.indexOf(`${index} />`) < 0) {
    return comp;
  }
  function Componentized() {
    return (0, import_react.createElement)(import_react.Fragment, null, comp);
  }
  return (0, import_react.createElement)(Componentized, {
    key: componentKey
  });
};
var generateArrayComponents = (components, translation) => components.map((c2, index) => fixComponentProps(c2, index, translation));
var generateObjectComponents = (components, translation) => {
  const componentMap = {};
  Object.keys(components).forEach((c2) => {
    Object.assign(componentMap, {
      [c2]: fixComponentProps(components[c2], c2, translation)
    });
  });
  return componentMap;
};
var generateComponents = (components, translation, i18n, i18nKey) => {
  if (!components) return null;
  if (Array.isArray(components)) {
    return generateArrayComponents(components, translation);
  }
  if (isObject(components)) {
    return generateObjectComponents(components, translation);
  }
  warnOnce(i18n, "TRANS_INVALID_COMPONENTS", `<Trans /> "components" prop expects an object or array`, {
    i18nKey
  });
  return null;
};
var isComponentsMap = (object) => {
  if (!isObject(object)) return false;
  if (Array.isArray(object)) return false;
  return Object.keys(object).reduce((acc, key) => acc && Number.isNaN(Number.parseFloat(key)), true);
};
function Trans({
  children,
  count,
  parent,
  i18nKey,
  context,
  tOptions = {},
  values,
  defaults,
  components,
  ns,
  i18n: i18nFromProps,
  t: tFromProps,
  shouldUnescape,
  ...additionalProps
}) {
  var _a, _b, _c, _d, _e, _f;
  const i18n = i18nFromProps || getI18n();
  if (!i18n) {
    warnOnce(i18n, "NO_I18NEXT_INSTANCE", `Trans: You need to pass in an i18next instance using i18nextReactModule`, {
      i18nKey
    });
    return children;
  }
  const t2 = tFromProps || i18n.t.bind(i18n) || ((k) => k);
  const reactI18nextOptions = {
    ...getDefaults(),
    ...(_a = i18n.options) == null ? void 0 : _a.react
  };
  let namespaces = ns || t2.ns || ((_b = i18n.options) == null ? void 0 : _b.defaultNS);
  namespaces = isString(namespaces) ? [namespaces] : namespaces || ["translation"];
  const {
    transDefaultProps
  } = reactI18nextOptions;
  const mergedTOptions = (transDefaultProps == null ? void 0 : transDefaultProps.tOptions) ? {
    ...transDefaultProps.tOptions,
    ...tOptions
  } : tOptions;
  const mergedShouldUnescape = shouldUnescape ?? (transDefaultProps == null ? void 0 : transDefaultProps.shouldUnescape);
  const mergedValues = (transDefaultProps == null ? void 0 : transDefaultProps.values) ? {
    ...transDefaultProps.values,
    ...values
  } : values;
  const mergedComponents = (transDefaultProps == null ? void 0 : transDefaultProps.components) ? {
    ...transDefaultProps.components,
    ...components
  } : components;
  const nodeAsString = nodesToString(children, reactI18nextOptions, i18n, i18nKey);
  const defaultValue = defaults || (mergedTOptions == null ? void 0 : mergedTOptions.defaultValue) || nodeAsString || reactI18nextOptions.transEmptyNodeValue || (typeof i18nKey === "function" ? keysFromSelector(i18nKey) : i18nKey);
  const {
    hashTransKey
  } = reactI18nextOptions;
  const key = i18nKey || (hashTransKey ? hashTransKey(nodeAsString || defaultValue) : nodeAsString || defaultValue);
  if ((_d = (_c = i18n.options) == null ? void 0 : _c.interpolation) == null ? void 0 : _d.defaultVariables) {
    values = mergedValues && Object.keys(mergedValues).length > 0 ? {
      ...mergedValues,
      ...i18n.options.interpolation.defaultVariables
    } : {
      ...i18n.options.interpolation.defaultVariables
    };
  } else {
    values = mergedValues;
  }
  const valuesFromChildren = getValuesFromChildren(children);
  if (valuesFromChildren && typeof valuesFromChildren.count === "number" && count === void 0) {
    count = valuesFromChildren.count;
  }
  const interpolationOverride = values || count !== void 0 && !((_f = (_e = i18n.options) == null ? void 0 : _e.interpolation) == null ? void 0 : _f.alwaysFormat) || !children ? mergedTOptions.interpolation : {
    interpolation: {
      ...mergedTOptions.interpolation,
      prefix: "#$?",
      suffix: "?$#"
    }
  };
  const combinedTOpts = {
    ...mergedTOptions,
    context: context || mergedTOptions.context,
    count,
    ...values,
    ...interpolationOverride,
    defaultValue,
    ns: namespaces
  };
  let translation = key ? t2(key, combinedTOpts) : defaultValue;
  if (translation === key && defaultValue) translation = defaultValue;
  const generatedComponents = generateComponents(mergedComponents, translation, i18n, i18nKey);
  let indexedChildren = generatedComponents || children;
  let componentsMap = null;
  if (isComponentsMap(generatedComponents)) {
    componentsMap = generatedComponents;
    indexedChildren = children;
  }
  const content = renderNodes(indexedChildren, componentsMap, translation, i18n, reactI18nextOptions, combinedTOpts, mergedShouldUnescape);
  const useAsParent = parent ?? reactI18nextOptions.defaultTransParent;
  return useAsParent ? (0, import_react.createElement)(useAsParent, additionalProps, content) : content;
}

// node_modules/react-i18next/dist/es/context.js
var import_react2 = __toESM(require_react(), 1);

// node_modules/react-i18next/dist/es/initReactI18next.js
var initReactI18next = {
  type: "3rdParty",
  init(instance) {
    setDefaults(instance.options.react);
    setI18n(instance);
  }
};

// node_modules/react-i18next/dist/es/context.js
var I18nContext = (0, import_react2.createContext)();
var ReportNamespaces = class {
  constructor() {
    this.usedNamespaces = {};
  }
  addUsedNamespaces(namespaces) {
    namespaces.forEach((ns) => {
      if (!this.usedNamespaces[ns]) this.usedNamespaces[ns] = true;
    });
  }
  getUsedNamespaces() {
    return Object.keys(this.usedNamespaces);
  }
};
var composeInitialProps = (ForComponent) => async (ctx) => {
  var _a;
  const componentsInitialProps = await ((_a = ForComponent.getInitialProps) == null ? void 0 : _a.call(ForComponent, ctx)) ?? {};
  const i18nInitialProps = getInitialProps();
  return {
    ...componentsInitialProps,
    ...i18nInitialProps
  };
};
var getInitialProps = () => {
  var _a;
  const i18n = getI18n();
  const namespaces = ((_a = i18n.reportNamespaces) == null ? void 0 : _a.getUsedNamespaces()) ?? [];
  const ret = {};
  const initialI18nStore = {};
  i18n.languages.forEach((l) => {
    initialI18nStore[l] = {};
    namespaces.forEach((ns) => {
      initialI18nStore[l][ns] = i18n.getResourceBundle(l, ns) || {};
    });
  });
  ret.initialI18nStore = initialI18nStore;
  ret.initialLanguage = i18n.language;
  return ret;
};

// node_modules/react-i18next/dist/es/Trans.js
function Trans2({
  children,
  count,
  parent,
  i18nKey,
  context,
  tOptions = {},
  values,
  defaults,
  components,
  ns,
  i18n: i18nFromProps,
  t: tFromProps,
  shouldUnescape,
  ...additionalProps
}) {
  var _a;
  const {
    i18n: i18nFromContext,
    defaultNS: defaultNSFromContext
  } = (0, import_react3.useContext)(I18nContext) || {};
  const i18n = i18nFromProps || i18nFromContext || getI18n();
  const t2 = tFromProps || (i18n == null ? void 0 : i18n.t.bind(i18n));
  return Trans({
    children,
    count,
    parent,
    i18nKey,
    context,
    tOptions,
    values,
    defaults,
    components,
    ns: ns || (t2 == null ? void 0 : t2.ns) || defaultNSFromContext || ((_a = i18n == null ? void 0 : i18n.options) == null ? void 0 : _a.defaultNS),
    i18n,
    t: tFromProps,
    shouldUnescape,
    ...additionalProps
  });
}

// node_modules/react-i18next/dist/es/IcuTrans.js
var import_react6 = __toESM(require_react(), 1);

// node_modules/react-i18next/dist/es/IcuTransWithoutContext.js
var import_react5 = __toESM(require_react(), 1);

// node_modules/react-i18next/dist/es/IcuTransUtils/TranslationParserError.js
var TranslationParserError = class _TranslationParserError extends Error {
  constructor(message, position, translationString) {
    super(message);
    this.name = "TranslationParserError";
    this.position = position;
    this.translationString = translationString;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, _TranslationParserError);
    }
  }
};

// node_modules/react-i18next/dist/es/IcuTransUtils/htmlEntityDecoder.js
var commonEntities = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&copy;": "©",
  "&reg;": "®",
  "&trade;": "™",
  "&hellip;": "…",
  "&ndash;": "–",
  "&mdash;": "—",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&sbquo;": "‚",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&bdquo;": "„",
  "&dagger;": "†",
  "&Dagger;": "‡",
  "&bull;": "•",
  "&prime;": "′",
  "&Prime;": "″",
  "&lsaquo;": "‹",
  "&rsaquo;": "›",
  "&sect;": "§",
  "&para;": "¶",
  "&middot;": "·",
  "&ensp;": " ",
  "&emsp;": " ",
  "&thinsp;": " ",
  "&euro;": "€",
  "&pound;": "£",
  "&yen;": "¥",
  "&cent;": "¢",
  "&curren;": "¤",
  "&times;": "×",
  "&divide;": "÷",
  "&minus;": "−",
  "&plusmn;": "±",
  "&ne;": "≠",
  "&le;": "≤",
  "&ge;": "≥",
  "&asymp;": "≈",
  "&equiv;": "≡",
  "&infin;": "∞",
  "&int;": "∫",
  "&sum;": "∑",
  "&prod;": "∏",
  "&radic;": "√",
  "&part;": "∂",
  "&permil;": "‰",
  "&deg;": "°",
  "&micro;": "µ",
  "&larr;": "←",
  "&uarr;": "↑",
  "&rarr;": "→",
  "&darr;": "↓",
  "&harr;": "↔",
  "&crarr;": "↵",
  "&lArr;": "⇐",
  "&uArr;": "⇑",
  "&rArr;": "⇒",
  "&dArr;": "⇓",
  "&hArr;": "⇔",
  "&alpha;": "α",
  "&beta;": "β",
  "&gamma;": "γ",
  "&delta;": "δ",
  "&epsilon;": "ε",
  "&zeta;": "ζ",
  "&eta;": "η",
  "&theta;": "θ",
  "&iota;": "ι",
  "&kappa;": "κ",
  "&lambda;": "λ",
  "&mu;": "μ",
  "&nu;": "ν",
  "&xi;": "ξ",
  "&omicron;": "ο",
  "&pi;": "π",
  "&rho;": "ρ",
  "&sigma;": "σ",
  "&tau;": "τ",
  "&upsilon;": "υ",
  "&phi;": "φ",
  "&chi;": "χ",
  "&psi;": "ψ",
  "&omega;": "ω",
  "&Alpha;": "Α",
  "&Beta;": "Β",
  "&Gamma;": "Γ",
  "&Delta;": "Δ",
  "&Epsilon;": "Ε",
  "&Zeta;": "Ζ",
  "&Eta;": "Η",
  "&Theta;": "Θ",
  "&Iota;": "Ι",
  "&Kappa;": "Κ",
  "&Lambda;": "Λ",
  "&Mu;": "Μ",
  "&Nu;": "Ν",
  "&Xi;": "Ξ",
  "&Omicron;": "Ο",
  "&Pi;": "Π",
  "&Rho;": "Ρ",
  "&Sigma;": "Σ",
  "&Tau;": "Τ",
  "&Upsilon;": "Υ",
  "&Phi;": "Φ",
  "&Chi;": "Χ",
  "&Psi;": "Ψ",
  "&Omega;": "Ω",
  "&Agrave;": "À",
  "&Aacute;": "Á",
  "&Acirc;": "Â",
  "&Atilde;": "Ã",
  "&Auml;": "Ä",
  "&Aring;": "Å",
  "&AElig;": "Æ",
  "&Ccedil;": "Ç",
  "&Egrave;": "È",
  "&Eacute;": "É",
  "&Ecirc;": "Ê",
  "&Euml;": "Ë",
  "&Igrave;": "Ì",
  "&Iacute;": "Í",
  "&Icirc;": "Î",
  "&Iuml;": "Ï",
  "&ETH;": "Ð",
  "&Ntilde;": "Ñ",
  "&Ograve;": "Ò",
  "&Oacute;": "Ó",
  "&Ocirc;": "Ô",
  "&Otilde;": "Õ",
  "&Ouml;": "Ö",
  "&Oslash;": "Ø",
  "&Ugrave;": "Ù",
  "&Uacute;": "Ú",
  "&Ucirc;": "Û",
  "&Uuml;": "Ü",
  "&Yacute;": "Ý",
  "&THORN;": "Þ",
  "&szlig;": "ß",
  "&agrave;": "à",
  "&aacute;": "á",
  "&acirc;": "â",
  "&atilde;": "ã",
  "&auml;": "ä",
  "&aring;": "å",
  "&aelig;": "æ",
  "&ccedil;": "ç",
  "&egrave;": "è",
  "&eacute;": "é",
  "&ecirc;": "ê",
  "&euml;": "ë",
  "&igrave;": "ì",
  "&iacute;": "í",
  "&icirc;": "î",
  "&iuml;": "ï",
  "&eth;": "ð",
  "&ntilde;": "ñ",
  "&ograve;": "ò",
  "&oacute;": "ó",
  "&ocirc;": "ô",
  "&otilde;": "õ",
  "&ouml;": "ö",
  "&oslash;": "ø",
  "&ugrave;": "ù",
  "&uacute;": "ú",
  "&ucirc;": "û",
  "&uuml;": "ü",
  "&yacute;": "ý",
  "&thorn;": "þ",
  "&yuml;": "ÿ",
  "&iexcl;": "¡",
  "&iquest;": "¿",
  "&fnof;": "ƒ",
  "&circ;": "ˆ",
  "&tilde;": "˜",
  "&OElig;": "Œ",
  "&oelig;": "œ",
  "&Scaron;": "Š",
  "&scaron;": "š",
  "&Yuml;": "Ÿ",
  "&ordf;": "ª",
  "&ordm;": "º",
  "&macr;": "¯",
  "&acute;": "´",
  "&cedil;": "¸",
  "&sup1;": "¹",
  "&sup2;": "²",
  "&sup3;": "³",
  "&frac14;": "¼",
  "&frac12;": "½",
  "&frac34;": "¾",
  "&spades;": "♠",
  "&clubs;": "♣",
  "&hearts;": "♥",
  "&diams;": "♦",
  "&loz;": "◊",
  "&oline;": "‾",
  "&frasl;": "⁄",
  "&weierp;": "℘",
  "&image;": "ℑ",
  "&real;": "ℜ",
  "&alefsym;": "ℵ"
};
var entityPattern = new RegExp(Object.keys(commonEntities).map((entity) => entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
var decodeHtmlEntities = (text) => text.replace(entityPattern, (match) => commonEntities[match]).replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10))).replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

// node_modules/react-i18next/dist/es/IcuTransUtils/tokenizer.js
var tokenize = (translation) => {
  const tokens = [];
  let position = 0;
  let currentText = "";
  const flushText = () => {
    if (currentText) {
      tokens.push({
        type: "Text",
        value: currentText,
        position: position - currentText.length
      });
      currentText = "";
    }
  };
  while (position < translation.length) {
    const char = translation[position];
    if (char === "<") {
      const tagMatch = translation.slice(position).match(/^<(\d+)>/);
      if (tagMatch) {
        flushText();
        tokens.push({
          type: "TagOpen",
          value: tagMatch[0],
          position,
          tagNumber: parseInt(tagMatch[1], 10)
        });
        position += tagMatch[0].length;
      } else {
        const closeTagMatch = translation.slice(position).match(/^<\/(\d+)>/);
        if (closeTagMatch) {
          flushText();
          tokens.push({
            type: "TagClose",
            value: closeTagMatch[0],
            position,
            tagNumber: parseInt(closeTagMatch[1], 10)
          });
          position += closeTagMatch[0].length;
        } else {
          currentText += char;
          position += 1;
        }
      }
    } else {
      currentText += char;
      position += 1;
    }
  }
  flushText();
  return tokens;
};

// node_modules/react-i18next/dist/es/IcuTransUtils/renderTranslation.js
var import_react4 = __toESM(require_react(), 1);
var renderDeclarationNode = (declaration, children, childDeclarations) => {
  const {
    type,
    props = {}
  } = declaration;
  if (props.children && Array.isArray(props.children) && childDeclarations) {
    const {
      children: _childrenToRemove,
      ...propsWithoutChildren
    } = props;
    return import_react4.default.createElement(type, propsWithoutChildren, ...children);
  }
  if (children.length === 0) {
    return import_react4.default.createElement(type, props);
  }
  if (children.length === 1) {
    return import_react4.default.createElement(type, props, children[0]);
  }
  return import_react4.default.createElement(type, props, ...children);
};
var renderTranslation = (translation, declarations = []) => {
  if (!translation) {
    return [];
  }
  const tokens = tokenize(translation);
  const result = [];
  const stack = [];
  const literalTagNumbers = /* @__PURE__ */ new Set();
  const getCurrentDeclarations = () => {
    var _a;
    if (stack.length === 0) {
      return declarations;
    }
    const parentFrame = stack[stack.length - 1];
    if (((_a = parentFrame.declaration.props) == null ? void 0 : _a.children) && Array.isArray(parentFrame.declaration.props.children)) {
      return parentFrame.declaration.props.children;
    }
    return parentFrame.declarations;
  };
  tokens.forEach((token) => {
    switch (token.type) {
      case "Text":
        {
          const decoded = decodeHtmlEntities(token.value);
          const targetArray = stack.length > 0 ? stack[stack.length - 1].children : result;
          targetArray.push(decoded);
        }
        break;
      case "TagOpen":
        {
          const {
            tagNumber
          } = token;
          const currentDeclarations = getCurrentDeclarations();
          const declaration = currentDeclarations[tagNumber];
          if (!declaration) {
            literalTagNumbers.add(tagNumber);
            const literalText = `<${tagNumber}>`;
            const targetArray = stack.length > 0 ? stack[stack.length - 1].children : result;
            targetArray.push(literalText);
            break;
          }
          stack.push({
            tagNumber,
            children: [],
            position: token.position,
            declaration,
            declarations: currentDeclarations
          });
        }
        break;
      case "TagClose":
        {
          const {
            tagNumber
          } = token;
          if (literalTagNumbers.has(tagNumber)) {
            const literalText = `</${tagNumber}>`;
            const literalTargetArray = stack.length > 0 ? stack[stack.length - 1].children : result;
            literalTargetArray.push(literalText);
            literalTagNumbers.delete(tagNumber);
            break;
          }
          if (stack.length === 0) {
            throw new TranslationParserError(`Unexpected closing tag </${tagNumber}> at position ${token.position}`, token.position, translation);
          }
          const frame = stack.pop();
          if (frame.tagNumber !== tagNumber) {
            throw new TranslationParserError(`Mismatched tags: expected </${frame.tagNumber}> but got </${tagNumber}> at position ${token.position}`, token.position, translation);
          }
          const element = renderDeclarationNode(frame.declaration, frame.children, frame.declarations);
          const elementTargetArray = stack.length > 0 ? stack[stack.length - 1].children : result;
          elementTargetArray.push(element);
        }
        break;
    }
  });
  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    throw new TranslationParserError(`Unclosed tag <${unclosed.tagNumber}> at position ${unclosed.position}`, unclosed.position, translation);
  }
  return result;
};

// node_modules/react-i18next/dist/es/IcuTransWithoutContext.js
function IcuTransWithoutContext({
  i18nKey,
  defaultTranslation,
  content,
  ns,
  values = {},
  i18n: i18nFromProps,
  t: tFromProps
}) {
  var _a, _b, _c, _d;
  const i18n = i18nFromProps || getI18n();
  if (!i18n) {
    warnOnce(i18n, "NO_I18NEXT_INSTANCE", `IcuTrans: You need to pass in an i18next instance using i18nextReactModule`, {
      i18nKey
    });
    return import_react5.default.createElement(import_react5.default.Fragment, {}, defaultTranslation);
  }
  const t2 = tFromProps || ((_a = i18n.t) == null ? void 0 : _a.bind(i18n)) || ((k) => k);
  let namespaces = ns || t2.ns || ((_b = i18n.options) == null ? void 0 : _b.defaultNS);
  namespaces = isString(namespaces) ? [namespaces] : namespaces || ["translation"];
  let mergedValues = values;
  if ((_d = (_c = i18n.options) == null ? void 0 : _c.interpolation) == null ? void 0 : _d.defaultVariables) {
    mergedValues = values && Object.keys(values).length > 0 ? {
      ...values,
      ...i18n.options.interpolation.defaultVariables
    } : {
      ...i18n.options.interpolation.defaultVariables
    };
  }
  const translation = t2(i18nKey, {
    defaultValue: defaultTranslation,
    ...mergedValues,
    ns: namespaces
  });
  try {
    const rendered = renderTranslation(translation, content);
    return import_react5.default.createElement(import_react5.default.Fragment, {}, ...rendered);
  } catch (error) {
    warn(i18n, "ICU_TRANS_RENDER_ERROR", `IcuTrans component error for key "${i18nKey}": ${error.message}`, {
      i18nKey,
      error
    });
    return import_react5.default.createElement(import_react5.default.Fragment, {}, translation);
  }
}
IcuTransWithoutContext.displayName = "IcuTransWithoutContext";

// node_modules/react-i18next/dist/es/IcuTrans.js
function IcuTrans({
  i18nKey,
  defaultTranslation,
  content,
  ns,
  values = {},
  i18n: i18nFromProps,
  t: tFromProps
}) {
  var _a;
  const {
    i18n: i18nFromContext,
    defaultNS: defaultNSFromContext
  } = (0, import_react6.useContext)(I18nContext) || {};
  const i18n = i18nFromProps || i18nFromContext || getI18n();
  const t2 = tFromProps || (i18n == null ? void 0 : i18n.t.bind(i18n));
  return IcuTransWithoutContext({
    i18nKey,
    defaultTranslation,
    content,
    ns: ns || (t2 == null ? void 0 : t2.ns) || defaultNSFromContext || ((_a = i18n == null ? void 0 : i18n.options) == null ? void 0 : _a.defaultNS),
    values,
    i18n,
    t: tFromProps
  });
}
IcuTrans.displayName = "IcuTrans";

// node_modules/react-i18next/dist/es/useTranslation.js
var import_react7 = __toESM(require_react(), 1);
var import_shim = __toESM(require_shim(), 1);
var notReadyT = (k, optsOrDefaultValue) => {
  if (isString(optsOrDefaultValue)) return optsOrDefaultValue;
  if (isObject(optsOrDefaultValue) && isString(optsOrDefaultValue.defaultValue)) return optsOrDefaultValue.defaultValue;
  return Array.isArray(k) ? k[k.length - 1] : k;
};
var notReadySnapshot = {
  t: notReadyT,
  ready: false
};
var dummySubscribe = () => () => {
};
var useTranslation = (ns, props = {}) => {
  var _a, _b, _c;
  const {
    i18n: i18nFromProps
  } = props;
  const {
    i18n: i18nFromContext,
    defaultNS: defaultNSFromContext
  } = (0, import_react7.useContext)(I18nContext) || {};
  const i18n = i18nFromProps || i18nFromContext || getI18n();
  if (i18n && !i18n.reportNamespaces) i18n.reportNamespaces = new ReportNamespaces();
  if (!i18n) {
    warnOnce(i18n, "NO_I18NEXT_INSTANCE", "useTranslation: You will need to pass in an i18next instance by using initReactI18next");
  }
  const i18nOptions = (0, import_react7.useMemo)(() => {
    var _a2;
    return {
      ...getDefaults(),
      ...(_a2 = i18n == null ? void 0 : i18n.options) == null ? void 0 : _a2.react,
      ...props
    };
  }, [i18n, props]);
  const {
    useSuspense,
    keyPrefix
  } = i18nOptions;
  const nsOrContext = ns || defaultNSFromContext || ((_a = i18n == null ? void 0 : i18n.options) == null ? void 0 : _a.defaultNS);
  const unstableNamespaces = isString(nsOrContext) ? [nsOrContext] : nsOrContext || ["translation"];
  const namespaces = (0, import_react7.useMemo)(() => unstableNamespaces, unstableNamespaces);
  (_c = (_b = i18n == null ? void 0 : i18n.reportNamespaces) == null ? void 0 : _b.addUsedNamespaces) == null ? void 0 : _c.call(_b, namespaces);
  const revisionRef = (0, import_react7.useRef)(0);
  const subscribe = (0, import_react7.useCallback)((callback) => {
    if (!i18n) return dummySubscribe;
    const {
      bindI18n,
      bindI18nStore
    } = i18nOptions;
    const wrappedCallback = () => {
      revisionRef.current += 1;
      callback();
    };
    if (bindI18n) i18n.on(bindI18n, wrappedCallback);
    if (bindI18nStore) i18n.store.on(bindI18nStore, wrappedCallback);
    return () => {
      if (bindI18n) bindI18n.split(" ").forEach((e2) => i18n.off(e2, wrappedCallback));
      if (bindI18nStore) bindI18nStore.split(" ").forEach((e2) => i18n.store.off(e2, wrappedCallback));
    };
  }, [i18n, i18nOptions]);
  const snapshotRef = (0, import_react7.useRef)();
  const getSnapshot = (0, import_react7.useCallback)(() => {
    if (!i18n) {
      return notReadySnapshot;
    }
    const calculatedReady = !!(i18n.isInitialized || i18n.initializedStoreOnce) && namespaces.every((n2) => hasLoadedNamespace(n2, i18n, i18nOptions));
    const currentLng = props.lng || i18n.language;
    const currentRevision = revisionRef.current;
    const lastSnapshot = snapshotRef.current;
    if (lastSnapshot && lastSnapshot.ready === calculatedReady && lastSnapshot.lng === currentLng && lastSnapshot.keyPrefix === keyPrefix && lastSnapshot.revision === currentRevision) {
      return lastSnapshot;
    }
    const calculatedT = i18n.getFixedT(currentLng, i18nOptions.nsMode === "fallback" ? namespaces : namespaces[0], keyPrefix);
    const newSnapshot = {
      t: calculatedT,
      ready: calculatedReady,
      lng: currentLng,
      keyPrefix,
      revision: currentRevision
    };
    snapshotRef.current = newSnapshot;
    return newSnapshot;
  }, [i18n, namespaces, keyPrefix, i18nOptions, props.lng]);
  const [loadCount, setLoadCount] = (0, import_react7.useState)(0);
  const {
    t: t2,
    ready
  } = (0, import_shim.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
  (0, import_react7.useEffect)(() => {
    if (i18n && !ready && !useSuspense) {
      const onLoaded = () => setLoadCount((c2) => c2 + 1);
      if (props.lng) {
        loadLanguages(i18n, props.lng, namespaces, onLoaded);
      } else {
        loadNamespaces(i18n, namespaces, onLoaded);
      }
    }
  }, [i18n, props.lng, namespaces, ready, useSuspense, loadCount]);
  const finalI18n = i18n || {};
  const wrapperRef = (0, import_react7.useRef)(null);
  const wrapperLangRef = (0, import_react7.useRef)();
  const createI18nWrapper = (original) => {
    const descriptors = Object.getOwnPropertyDescriptors(original);
    if (descriptors.__original) delete descriptors.__original;
    const wrapper = Object.create(Object.getPrototypeOf(original), descriptors);
    if (!Object.prototype.hasOwnProperty.call(wrapper, "__original")) {
      try {
        Object.defineProperty(wrapper, "__original", {
          value: original,
          writable: false,
          enumerable: false,
          configurable: false
        });
      } catch (_) {
      }
    }
    return wrapper;
  };
  const ret = (0, import_react7.useMemo)(() => {
    const original = finalI18n;
    const lang = original == null ? void 0 : original.language;
    let i18nWrapper = original;
    if (original) {
      if (wrapperRef.current && wrapperRef.current.__original === original) {
        if (wrapperLangRef.current !== lang) {
          i18nWrapper = createI18nWrapper(original);
          wrapperRef.current = i18nWrapper;
          wrapperLangRef.current = lang;
        } else {
          i18nWrapper = wrapperRef.current;
        }
      } else {
        i18nWrapper = createI18nWrapper(original);
        wrapperRef.current = i18nWrapper;
        wrapperLangRef.current = lang;
      }
    }
    const arr = [t2, i18nWrapper, ready];
    arr.t = t2;
    arr.i18n = i18nWrapper;
    arr.ready = ready;
    return arr;
  }, [t2, finalI18n, ready, finalI18n.resolvedLanguage, finalI18n.language, finalI18n.languages]);
  if (i18n && useSuspense && !ready) {
    throw new Promise((resolve) => {
      const onLoaded = () => resolve();
      if (props.lng) {
        loadLanguages(i18n, props.lng, namespaces, onLoaded);
      } else {
        loadNamespaces(i18n, namespaces, onLoaded);
      }
    });
  }
  return ret;
};

// node_modules/react-i18next/dist/es/withTranslation.js
var import_react8 = __toESM(require_react(), 1);
var withTranslation = (ns, options = {}) => function Extend(WrappedComponent) {
  function I18nextWithTranslation({
    forwardedRef,
    ...rest
  }) {
    const [t2, i18n, ready] = useTranslation(ns, {
      ...rest,
      keyPrefix: options.keyPrefix
    });
    const passDownProps = {
      ...rest,
      t: t2,
      i18n,
      tReady: ready
    };
    if (options.withRef && forwardedRef) {
      passDownProps.ref = forwardedRef;
    } else if (!options.withRef && forwardedRef) {
      passDownProps.forwardedRef = forwardedRef;
    }
    return (0, import_react8.createElement)(WrappedComponent, passDownProps);
  }
  I18nextWithTranslation.displayName = `withI18nextTranslation(${getDisplayName(WrappedComponent)})`;
  I18nextWithTranslation.WrappedComponent = WrappedComponent;
  const forwardRef = (props, ref) => (0, import_react8.createElement)(I18nextWithTranslation, Object.assign({}, props, {
    forwardedRef: ref
  }));
  return options.withRef ? (0, import_react8.forwardRef)(forwardRef) : I18nextWithTranslation;
};

// node_modules/react-i18next/dist/es/Translation.js
var Translation = ({
  ns,
  children,
  ...options
}) => {
  const [t2, i18n, ready] = useTranslation(ns, options);
  return children(t2, {
    i18n,
    lng: i18n.language
  }, ready);
};

// node_modules/react-i18next/dist/es/I18nextProvider.js
var import_react9 = __toESM(require_react(), 1);
function I18nextProvider({
  i18n,
  defaultNS,
  children
}) {
  const value = (0, import_react9.useMemo)(() => ({
    i18n,
    defaultNS
  }), [i18n, defaultNS]);
  return (0, import_react9.createElement)(I18nContext.Provider, {
    value
  }, children);
}

// node_modules/react-i18next/dist/es/withSSR.js
var import_react11 = __toESM(require_react(), 1);

// node_modules/react-i18next/dist/es/useSSR.js
var import_react10 = __toESM(require_react(), 1);
var useSSR = (initialI18nStore, initialLanguage, props = {}) => {
  var _a;
  const {
    i18n: i18nFromProps
  } = props;
  const {
    i18n: i18nFromContext
  } = (0, import_react10.useContext)(I18nContext) || {};
  const i18n = i18nFromProps || i18nFromContext || getI18n();
  if ((_a = i18n.options) == null ? void 0 : _a.isClone) return;
  if (initialI18nStore && !i18n.initializedStoreOnce) {
    i18n.services.resourceStore.data = initialI18nStore;
    i18n.options.ns = Object.values(initialI18nStore).reduce((mem, lngResources) => {
      Object.keys(lngResources).forEach((ns) => {
        if (mem.indexOf(ns) < 0) mem.push(ns);
      });
      return mem;
    }, i18n.options.ns);
    i18n.initializedStoreOnce = true;
    i18n.isInitialized = true;
  }
  if (initialLanguage && !i18n.initializedLanguageOnce) {
    i18n.changeLanguage(initialLanguage);
    i18n.initializedLanguageOnce = true;
  }
};

// node_modules/react-i18next/dist/es/withSSR.js
var withSSR = () => function Extend(WrappedComponent) {
  function I18nextWithSSR({
    initialI18nStore,
    initialLanguage,
    ...rest
  }) {
    useSSR(initialI18nStore, initialLanguage);
    return (0, import_react11.createElement)(WrappedComponent, {
      ...rest
    });
  }
  I18nextWithSSR.getInitialProps = composeInitialProps(WrappedComponent);
  I18nextWithSSR.displayName = `withI18nextSSR(${getDisplayName(WrappedComponent)})`;
  I18nextWithSSR.WrappedComponent = WrappedComponent;
  return I18nextWithSSR;
};

// node_modules/react-i18next/dist/es/index.js
var date = () => "";
var time = () => "";
var number = () => "";
var select = () => "";
var plural = () => "";
var selectOrdinal = () => "";
export {
  I18nContext,
  I18nextProvider,
  IcuTrans,
  IcuTransWithoutContext,
  Trans2 as Trans,
  Trans as TransWithoutContext,
  Translation,
  composeInitialProps,
  date,
  getDefaults,
  getI18n,
  getInitialProps,
  initReactI18next,
  nodesToString,
  number,
  plural,
  select,
  selectOrdinal,
  setDefaults,
  setI18n,
  time,
  useSSR,
  useTranslation,
  withSSR,
  withTranslation
};
//# sourceMappingURL=react-i18next.js.map
