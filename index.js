"use strict";
exports.__esModule = true;
var parser = require("comment-parser");
var glob = require("glob");
var fs = require("fs");
var typler_1 = require("typler");
var findTags = function (name, tags) {
    return tags.filter(function (tag) { return tag.tag === name; });
};
var findTag = function (name, tags) {
    return tags.find(function (tag) { return tag.tag === name; });
};
var getOrCreateEntry_DIRTY = function (name, type, entries) {
    var entry = entries[name];
    if (!entry) {
        entry = {
            path: name,
            params: [],
            methods: [],
            formats: [],
            description: '',
            tag: type || 'default'
        };
        entries[name] = entry;
    }
    return entry;
};
var makeType = function (originalType) {
    var parsedType = typler_1.parseType(originalType)[0];
    var type = { type: parsedType.type || null, of: null };
    if (parsedType.of)
        type.of = parsedType.of[0].type;
    return type;
};
var createParams = function (paramTags) {
    var paramPlaceRegex = /^\s*#[^\s]*/;
    return paramTags.map(function (_a) {
        var name = _a.name, type = _a.type, optional = _a.optional, originalDescription = _a.description;
        var place = 'path';
        var description = originalDescription;
        var mathched = originalDescription.match(paramPlaceRegex);
        if (mathched) {
            place = mathched[0].replace(/[\s#]/, '');
            description = originalDescription.replace(paramPlaceRegex, '');
        }
        return {
            name: name,
            type: makeType(type),
            isRequired: !optional,
            description: description,
            place: place
        };
    });
};
var createFormats = function (paramTags) {
    return paramTags.reduce(function (result, _a) {
        var name = _a.name;
        if (result.indexOf(name) === -1)
            result.push(name);
        return result;
    }, []);
};
var createResponses = function (paramTags) {
    var codeRegex = /\d+\s*[-\s]*/;
    return paramTags.map(function (_a) {
        var name = _a.name, type = _a.type, description = _a.description;
        return {
            type: makeType(type),
            code: name,
            description: description
        };
    });
};
var parseFiles = function (pathGlob) {
    var parse = parser;
    var entries = {};
    return new Promise(function (resolve) {
        glob(pathGlob, function (err, files) {
            var promises = files.map(function (file) {
                return new Promise(function (resolve) {
                    parse.file(file, function (err, data) {
                        data
                            .filter(function (_a) {
                            var tags = _a.tags;
                            return findTag('api', tags);
                        })
                            .forEach(function (_a) {
                            var tags = _a.tags, description = _a.description;
                            var apiTag = findTag('api', tags);
                            var methodTag = findTag('method', tags);
                            var descriptionTag = findTag('description', tags);
                            var entry = getOrCreateEntry_DIRTY(apiTag.name, apiTag.type, entries);
                            var params = createParams(findTags('param', tags));
                            var formats = createFormats(findTags('type', tags));
                            var responses = createResponses(findTags('return', tags));
                            if (methodTag) {
                                entry.methods.push({
                                    method: methodTag.name,
                                    path: apiTag.name,
                                    description: descriptionTag ? descriptionTag.name + " " + descriptionTag.description : description,
                                    summary: description,
                                    params: params,
                                    formats: formats,
                                    responses: responses
                                });
                            }
                            else {
                                entry.description = description || entry.description;
                                entry.params = params;
                                entry.formats = formats;
                            }
                        });
                        resolve(entries);
                    });
                });
            });
            Promise.all(promises)
                .then(function () {
                resolve(entries);
            })["catch"](function (err) {
                console.error('Error while parsing', err);
            });
        });
    });
};
var convertParamToSwaggerFormat = function (_a) {
    var name = _a.name, isRequired = _a.isRequired, type = _a.type, description = _a.description, place = _a.place;
    var param = {
        name: name,
        required: isRequired,
        description: description,
        type: type.type.toLowerCase(),
        "in": place
    };
    if (type.of) {
        param.items = {
            type: type.of.toLowerCase()
        };
    }
    return param;
};
var generateSwaggerConfig = function (entries) {
    var config = {
        swagger: "2.0",
        info: {
            description: "API",
            version: "1.0.0",
            title: "API"
        },
        paths: {}
    };
    config.paths = Object.keys(entries).reduce(function (paths, key) {
        var _a = entries[key], tag = _a.tag, path = _a.path, methods = _a.methods, entryFormats = _a.formats, entryParams = _a.params;
        paths[path] = methods.reduce(function (methods, _a) {
            var method = _a.method, formats = _a.formats, description = _a.description, summary = _a.summary, params = _a.params, responses = _a.responses;
            var format = formats.length > 0 ? formats : entryFormats;
            methods[method] = {
                tags: [tag],
                summary: summary,
                description: description,
                consumes: format,
                produces: format,
                parameters: (params.length > 0 ? params : entryParams)
                    .map(function (param) { return convertParamToSwaggerFormat(param); }),
                responses: responses.reduce(function (result, response) {
                    result[response.code] = {
                        description: response.description
                    };
                    return result;
                }, {})
            };
            return methods;
        }, {});
        return paths;
    }, {});
    return config;
};
exports.parse = function (pathGlobal, outFilepath) {
    if (outFilepath === void 0) { outFilepath = ''; }
    return new Promise(function (resolve, reject) {
        parseFiles(pathGlobal)
            .then(function (entries) {
            var config = generateSwaggerConfig(entries);
            if (!outFilepath)
                return resolve(config);
            fs.writeFile(outFilepath, JSON.stringify(config, null, 4), function (err) {
                if (err)
                    return reject(err);
                resolve(config);
            });
        })["catch"](function (err) {
            console.error('Error!', err);
        });
    });
};
