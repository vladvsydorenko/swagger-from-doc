import * as parser from 'comment-parser';
import * as glob from 'glob';
import * as fs from 'fs';
import {parseType} from 'typler';

interface ApiParam {
    name: string;
    isRequired: boolean;
    type: any;
    description: string;
    place: string; // path, body, query etc
}

interface ApiResponse {
    code: number;
    type: any;
    description: string;
}

interface ApiMethod {
    method: string;
    path: string;
    summary: string;
    description: string;
    params: ApiParam[];
    responses: ApiResponse[];
    formats: string[];
}

interface ApiEntry {
    path: string;
    params: ApiParam[];
    methods: ApiMethod[];
    formats: string[];
    tag: string;
    description: string;
}

const findTags = (name, tags) => {
    return tags.filter(tag => tag.tag === name);
};

const findTag = (name, tags) => {
    return tags.find(tag => tag.tag === name);
};

const getOrCreateEntry_DIRTY = (name, type, entries: {[id: string]: ApiEntry}): ApiEntry => {
    let entry = entries[name];

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

const makeType = (originalType: any): { type: string, of: string | null } => {
    const parsedType = parseType(originalType)[0];
    const type = { type: parsedType.type || null, of: null };
    if (parsedType.of) type.of = parsedType.of[0].type;
    return type;
};

const createParams = (paramTags): ApiParam[] => {
    const paramPlaceRegex = /^\s*#[^\s]*/;

    return paramTags.map(({ name, type, optional, description: originalDescription }): ApiParam => {
        let place = 'path';
        let description = originalDescription;
        
        const mathched = originalDescription.match(paramPlaceRegex);
        if (mathched) {
            place = mathched[0].replace(/[\s#]/, '');
            description = originalDescription.replace(paramPlaceRegex, '');
        }

        return {
            name,
            type: makeType(type),
            isRequired: !optional,
            description,
            place,
        };
    });
};

const createFormats = (paramTags): string[] => {
    return paramTags.reduce((result, { name }) => {
        if (result.indexOf(name) === -1) result.push(name);
        return result;
    }, []);
};

const createResponses = (paramTags): ApiResponse[] => {
    const codeRegex = /\d+\s*[-\s]*/;
    return paramTags.map(({ name, type, description }): ApiResponse => {
        return {
            type: makeType(type),
            code: name,
            description,
        };
    });
};

const parseFiles = (pathGlob): Promise<{[id: string]: ApiEntry}> => {
    const parse: any = parser;
    const entries: {[id: string]: ApiEntry} = {};

    return new Promise((resolve) => {
        glob(pathGlob, (err, files) => {
            const promises = files.map((file) => {
                return new Promise((resolve) => {
                    parse.file(file, (err, data) => {
                        data
                            .filter(({ tags }) => findTag('api', tags))
                            .forEach(({ tags, description }) => {
                                const apiTag = findTag('api', tags);
                                const methodTag = findTag('method', tags);
                                const descriptionTag = findTag('description', tags);
                                const entry = getOrCreateEntry_DIRTY(apiTag.name, apiTag.type, entries);
                                const params = createParams(findTags('param', tags));
                                const formats = createFormats(findTags('type', tags));
                                const responses = createResponses(findTags('return', tags));
            
                                if (methodTag) {
                                    entry.methods.push({
                                        method: methodTag.name,
                                        path: apiTag.name,
                                        description: descriptionTag ? `${descriptionTag.name} ${descriptionTag.description}` : description,
                                        summary: description,
                                        params,
                                        formats,
                                        responses,
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
                .then(() => {
                    resolve(entries);
                })
                .catch((err) => {
                    console.error('Error while parsing', err);
                });
        });
    });
};

const convertParamToSwaggerFormat = ({name, isRequired, type, description, place}: ApiParam) => {
    const param: any = {
        name,
        required: isRequired,
        description,
        type: type.type.toLowerCase(),
        in: place,
    };

    if (type.of) {
        param.items = {
            type: type.of.toLowerCase(),
        };
    }

    return param;
};

const generateSwaggerConfig = (entries: {[id: string]: ApiEntry}) => {
    const config: any = {
        swagger: "2.0",
        info: {
            description: "API",
            version: "1.0.0",
            title: "API",
        },
        paths: {},
    };

    config.paths = Object.keys(entries).reduce((paths, key) => {
        const {
            tag,
            path,
            methods,
            formats: entryFormats,
            params: entryParams,
        } = entries[key];

        paths[path] = methods.reduce(
            (methods, {method, formats, description, summary, params, responses}) => {
                const format = formats.length > 0 ? formats : entryFormats;
                
                methods[method] = {
                    tags: [tag],
                    summary,
                    description,
                    consumes: format,
                    produces: format,
                    parameters: (params.length > 0 ? params : entryParams)
                                .map(param => convertParamToSwaggerFormat(param)),
                    responses: responses.reduce((result, response) => {
                        result[response.code] = {
                            description: response.description,
                        }
                        return result;
                    }, {})
                };
                
                return methods;

            },
        {});

        return paths;
    }, {});

    return config;
};

export const parse = (pathGlobal, outFilepath) => {
    return new Promise((resolve) => {
        parseFiles(pathGlobal)
            .then((entries) => {
                const config = generateSwaggerConfig(entries);
                fs.writeFileSync(outFilepath, JSON.stringify(config, null, 4));
                resolve(entries);
            })
            .catch((err) => {
                console.error('Error!', err);
            });
    });
};
