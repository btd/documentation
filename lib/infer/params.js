'use strict';

var shouldSkipInference = require('./should_skip_inference'),
  t = require('babel-types'),
  finders = require('./finders'),
  flowDoctrine = require('../flow_doctrine');

function paramToDoc(param, comment, i, prefix) {

  prefix = prefix || '';

  function addPrefix(doc) {
    if (!Array.isArray(doc)) {
      doc.name = prefix + doc.name;
    }
    return doc;
  }

  /**
   * Given a parameter like
   *
   *     function a(b = 1)
   *
   * Format it as an optional parameter in JSDoc land
   *
   * @param {Object} param ESTree node
   * @returns {Object} JSDoc param
   */
  function paramWithDefaultToDoc(param) {
    var newParam = paramToDoc(param.left, comment, i);

    var defaultValue = comment.context.code.substring(
        param.right.start, param.right.end);

    // this is a destructuring parameter with defaults
    if (Array.isArray(newParam)) {
      newParam[0].default = defaultValue;
      return newParam;
    }

    var optionalParam = {
      title: 'param',
      name: newParam.name,
      'default': defaultValue
    };

    if (newParam.type) {
      optionalParam.type = {
        type: 'OptionalType',
        expression: newParam.type
      };
    }

    return optionalParam;
  }

  function destructuringPropertyToDoc(property) {
    if (property.type === 'ObjectProperty') {
      return paramToDoc(property.value, comment, i, prefix + '$' + i + '.');
    } else if (property.type === 'Identifier') {
      // if the destructuring type is an array, the elements
      // in it are identifiers
      return paramToDoc(property, comment, i, prefix + '$' + i + '.');
    } else if (property.type === 'RestProperty') {
      return paramToDoc(property, comment, i, prefix + '$' + i + '.');
    }
  }

  function destructuringObjectParamToDoc(param) {
    return [{
      title: 'param',
      name: '$' + i,
      type: flowDoctrine(param) || {
        type: 'NameExpression',
        name: 'Object'
      }
    }].concat(param.properties.map(destructuringPropertyToDoc));
  }

  function destructuringArrayParamToDoc(param) {
    return [{
      title: 'param',
      name: '$' + i,
      type: flowDoctrine(param) || {
        type: 'NameExpression',
        name: 'Array'
      }
    }].concat(param.elements.map(destructuringPropertyToDoc));
  }

  function restParamToDoc(param) {
    var newParam = {
      title: 'param',
      name: param.argument.name,
      lineNumber: param.loc.start.line,
      type: {
        type: 'RestType'
      }
    };
    if (param.typeAnnotation) {
      newParam.type.expression = flowDoctrine(param.typeAnnotation.typeAnnotation);
    }
    return newParam;
  }

  // ES6 default
  if (param.type === 'AssignmentPattern') {
    return addPrefix(paramWithDefaultToDoc(param));
  }

  if (param.type === 'ObjectPattern') {
    return addPrefix(destructuringObjectParamToDoc(param));
  }

  if (param.type === 'ArrayPattern') {
    return addPrefix(destructuringArrayParamToDoc(param));
  }

  if (param.type === 'RestProperty' || param.type === 'RestElement') {
    return addPrefix(restParamToDoc(param));
  }

  var newParam = {
    title: 'param',
    name: param.name,
    lineNumber: param.loc.start.line
  };

  // Flow/TS annotations
  if (param.typeAnnotation && param.typeAnnotation.typeAnnotation) {
    newParam.type = flowDoctrine(param.typeAnnotation.typeAnnotation);
  }

  return addPrefix(newParam);
}

/**
 * Infers param tags by reading function parameter names
 *
 * @name inferParams
 * @param {Object} comment parsed comment
 * @returns {Object} comment with parameters
 */
module.exports = function () {
  return shouldSkipInference(function inferParams(comment) {
    var node = finders.findTarget(comment.context.ast);

    if (!t.isFunction(node)) {
      return comment;
    }

    // Ensure that explicitly specified parameters are not overridden
    // by inferred parameters
    var existingParams = (comment.params || []).reduce(function (memo, param) {
      memo[param.name] = param;
      return memo;
    }, {});

    var paramOrder = {};
    var i = 0;

    node.params
      .reduce(function (params, param, i) {
        return params.concat(paramToDoc(param, comment, i));
      }, [])
      .forEach(function (doc) {
        if (!existingParams.hasOwnProperty(doc.name)) {
          // This type is not explicitly documented
          if (!comment.params) {
            comment.params = [];
          }

          comment.params = comment.params.concat(doc);
        } else if (!existingParams[doc.name].type) {
          // This param has a description, but potentially it can
          // be have an inferred type. Infer its type without
          // dropping the description.
          if (doc.type) {
            existingParams[doc.name].type = doc.type;
          }
        } else if (existingParams[doc.name].type.type !== 'OptionalType' &&
          doc.default) {
          existingParams[doc.name].type = {
            type: 'OptionalType',
            expression: existingParams[doc.name].type,
            default: doc.default
          };
        }
        paramOrder[doc.name] = i++;
      });

    // Ensure that if params are specified partially or in
    // the wrong order, they'll be output in the order
    // they actually appear in code
    if (comment.params) {
      comment.params.sort(function (a, b) {
        return paramOrder[a.name] - paramOrder[b.name];
      });
    }

    return comment;
  });
};
