SPRUT = true
const getStack = [];
const setTasks = [];
const syncTasks = [];
let isSettersLaunched = false;
let DevHelper;

const StoreData = Symbol('storeData');
const Default = Symbol('default');
const Hush = Symbol('hush');
const Value = Symbol('value');
const ImmediateValue = Symbol('immediateValue');
const DeferredValue = Symbol('deferredValue');
const AutoConfig = Symbol('autoConfig');
const Waiting = Symbol('waiting');
const CancelAction = Symbol('cancelAction');
const WaitingCanceled = Symbol('waitingCanceled');
const WaitingPoint = Symbol('waitingPoint');
const HiddenStoreField = Symbol('hiddenStoreField');
const NoValue = Symbol('noValue');
const Fields = {
    computed: Symbol('computed'),
    reactive: Symbol('reactive'),
    method: Symbol('method')
}
let timeoutFunction = setTimeout;

class HiddenStore {
    constructor() {
        initStore(this);
    }
}
storable(HiddenStore);
const hiddenStore = new HiddenStore();
let callbackCount = 0;

function init(cls) {
    if (!cls[Default]) {
        cls[Default] = {
            changeCallbacks: {},
            values: {},
            updateImmediately: {},
            config: {},
            dependenciesTest: {},
            initedStart: {},
            configSymbols: [],
            configuredFields: [],
            isFactory: {},
            fieldTypes: {}
        };
    }
}

function data(object) {
    if (!object[StoreData]) {
        object[StoreData] = {
            subscribers: {},
            cache: {},
            values: {},
            localChangeCallbacks: {},
            isHandledChange: {},
            dependencies: {},
            initedReactive: {},
            waitingResults: {}
        };
    }

    return object[StoreData];
}

function dflt(cls) {
    return cls[Default];
}

function initReactive(object, field) {
    const storeData = data(object);

    if (!storeData.initedReactive[field]) {
        const defaultValue = dflt(object.__proto__.constructor).values[field];

        if (dflt(object.__proto__.constructor).isFactory[field] && defaultValue instanceof Function) {
            storeData.values[field] = defaultValue.apply(object);
        } else {
            storeData.values[field] = defaultValue;
        }

        storeData.initedReactive[field] = true;
    }
}

function _reactive(cls, field, def, onSet, updateImmediately, isFactory) {
	dflt(cls).values[field] = def;

    addconfiguredField(cls, field, Fields.reactive);

    if (updateImmediately !== true && updateImmediately !== false) {
        dflt(cls).updateImmediately[field] = dflt(cls).config.updateImmediately;
    } else {
        dflt(cls).updateImmediately[field] = updateImmediately;
    }

    if (isFactory) {
        dflt(cls).isFactory[field] = true;
    }

	Object.defineProperty(cls.prototype, field, {
		get() {
            const storeData = data(this);

            initReactive(this, field)

            resolveDependencies(this, field, true);

            let value = storeData.values[field];

            if (value !== null && value !== undefined) {
                if (value[Waiting]) {
                    storeData.waitingResults[field] = value;
                    value[WaitingPoint] = { object: this, field };
                    storeData.values[field] = Waiting;
                    value = Waiting;
                }
            }

			if (value !== Waiting && value instanceof Object && !value.isStorable) {
				return innerWathcer(this, value, field);
			}

			return value;
		},
		set(v) {
            const storeData = data(this);
            let isPut = false;

            initReactive(this, field)

            if (v instanceof Object && v.isPut) {
                isPut = true;
                v = v.value;
            }

            if(v && v[Hush]) {
				storeData.values[field] = v[Value];
			} else {
				const prev = storeData.values[field];
                const isImmediate = isImmediately(v);
                const isDeferred = isDeferredly(v);
				let newV = isImmediate || isDeferred ? v[Value] : v;

				if(onSet instanceof Function) {
					let setRes = onSet.apply(this, [prev, newV]);

					newV = setRes !== undefined ? setRes : newV;
				}
				if (newV !== prev) {
                    if (!isPut) {
                        if (storeData.waitingResults[field]) {
                            storeData.waitingResults[field][WaitingCanceled] = true;
                        }
                        if (storeData.waitingResults[field] && storeData.waitingResults[field][CancelAction]) {
                            storeData.waitingResults[field][CancelAction]();
                        }
                        delete storeData.waitingResults[field];
                    }

                    if (!isDeferred && (isImmediate || dflt(cls).updateImmediately[field])) {
					    storeData.values[field] = newV;

					    change(this, field);
                        execSyncTasks();
                    } else {
                        setTask(this, field, newV);
                    }
				}
			}
		},
        configurable: true,
        enumerable: true
	})
}

function innerWathcer(that, object, field, innerProp = field) {
	return new Proxy(object, {
		get(target, prop) {
            if (prop === HiddenStoreField) {
                return field;
            }

            resolveDependencies(that, `${innerProp}.${prop.toString()}`);

            if (isArrayMutationMethod(prop)) {
                return arrayMutationMethod(prop, that, object, field, `${innerProp}.${prop.toString()}`);
            } else if (prop in target && target[prop] instanceof Object && target.hasOwnProperty(prop)) {
				return innerWathcer(that, target[prop], field, `${innerProp}.${prop.toString()}`);
			}

			return target[prop];
		},
		set(target, prop, val) {
			if (target[prop] !== val) {
                const isImmediate = isImmediately(val);
                const isDeferred = isDeferredly(val);
                const value = isImmediate || isDeferred ? val[Value] : val;

                if (!isDeferred && (isImmediate || dflt(that.__proto__.constructor).updateImmediately[field])) {
				    target[prop] = value;
				    change(that, `${innerProp}.${prop.toString()}`);
                    execSyncTasks();
                } else {
                    setTask(that, `${innerProp}.${prop.toString()}`/*field*/, NoValue/*data(that).values[field]*/, () => target[prop] = value);
                }
			}

			return true;
		}
	});
}

function arrayMutationMethod(method, that, object, field, prop) {
    return function(...args) {
        if (dflt(that.__proto__.constructor).updateImmediately[field]) {
            Array.prototype[method].apply(this, args);
            change(that, prop);
            execSyncTasks();
        } else {
            setTask(that, prop, NoValue, () => Array.prototype[method].apply(this, args));
        }

        return Array.prototype[method].apply([...this], args);
    }
};

function resolveDependencies(object, field, isReactive) {
    const storeData = data(object);

    if (!storeData.subscribers[field]) storeData.subscribers[field] = [];
    if (!isReactive && !storeData.dependencies[field]) storeData.dependencies[field] = [];

	const stacked = getStack[getStack.length - 1];

    if (stacked) {
        const stackedData = data(stacked.object);

        if (!stackedData.dependencies[stacked.field]) stackedData.dependencies[stacked.field] = [];
        if (!storeData.subscribers[field].find(s => s.field === stacked.field && s.object === stacked.object)) {
            storeData.subscribers[field].push(stacked);
            stackedData.dependencies[stacked.field].push({ object, field });
        }
    }
}

function _computed(cls, field, getter, setter) {
    addconfiguredField(cls, field, Fields.computed);

	Object.defineProperty(cls.prototype, field, {
		get() {
            const storeData = data(this);

            resolveDependencies(this, field);

			if (storeData.cache[field]) {
				return storeData.cache[field];
			}

			watch(this, field);

			const result = getter.apply(this);

			storeData.cache[field] = result[Waiting] ? Waiting : result;

            if (storeData.waitingResults[field]) {
                storeData.waitingResults[field][WaitingCanceled] = true;
            }
            if (storeData.waitingResults[field] && storeData.waitingResults[field][CancelAction]) {
                storeData.waitingResults[field][CancelAction]();
            }
            if (result !== null && result !== undefined) {
                if (result[Waiting]) {
                    storeData.waitingResults[field] = result;
                } else {
                    delete storeData.waitingResults[field];                
                }
            }

			unwatch();

			return result[Waiting] ? Waiting : result;
		},
        set(v) {
            if (setter) {
                setter.apply(this, [v]);
            } else {}
        },
        configurable: true,
        enumerable: true
	});
}

function _method(cls, field, methodConfig) {
    const classData = dflt(cls);

    addconfiguredField(cls, field, Fields.method);

	if (methodConfig.callback || methodConfig.autoExec) {
		const method = methodConfig.method || cls.prototype[field];

		Object.defineProperty(cls.prototype, field, {
			value(...args) {
                clearDependencies(methodConfig.context || this, field);
				watch(this, field);
				const res = method.apply(this, args);
				unwatch();
		
				return res;
			},
            configurable: true,
            enumerable: true
		});
		cls.onChange(field, methodConfig.callback || cls.prototype[field]);

        if (methodConfig.dependencies && !methodConfig.initedStart) {
            classData.dependenciesTest[field] = methodConfig.dependencies;
        }
        if (methodConfig.initedStart) {
            classData.initedStart[field] = true;
        }
	} else if (methodConfig.binding) {
		Object.defineProperty(cls.prototype, field, {
			get() {
				Object.defineProperty(this, field, {
					value: methodConfig.method.bind(this),
                    configurable: true,
                    enumerable: true
				});
			
				return this[field];
			},
            configurable: true,
            enumerable: true
		});
	} else {
		Object.defineProperty(cls.prototype, field, {
			value: methodConfig.method,
            configurable: true,
            enumerable: true
		});
	}
}

function storable(object, config = {}) {
	if (!object.isStorable) {
		object.isStorable = object.prototype.isStorable = true;

        init(object);

        const { updateImmediately = false } = config;
        const classData = dflt(object);

        classData.config.updateImmediately = updateImmediately;

		Object.defineProperty(object, 'computed', {
			value: function(field, getter, setter) {
				_computed(this, field, getter, setter);
			},
            enumerable: false
		});
		Object.defineProperty(object, 'reactive', {
			value: function(field, def, onSet, updateImmediately, isFactory) {
                _reactive(this, field, def, onSet, updateImmediately, isFactory);
			},
            enumerable: false
		});
        Object.defineProperty(object, 'method', {
			value: function(field, methodConfig) {
                _method(this, field, methodConfig);
			},
            enumerable: false
		});
		Object.defineProperty(object, 'configure', {
			value: function({ reactive, methods, computed } = {}) {
				for(let field in reactive) {
					this.reactive(field, reactive[field] instanceof Object && ('default' in reactive[field]) ? reactive[field].default : reactive[field], reactive[field] && reactive[field].setter || null, reactive[field] && reactive[field].immediate, reactive[field] && reactive[field].isFactory);
				}
				for(let field in computed) {
					this.computed(field, computed[field] instanceof Function ? computed[field] : computed[field] && computed[field].getter || null, computed[field] && computed[field].setter || null);
                }
				for(let field in methods) {
					if (methods[field]) {
                        this.method(field, methods[field]);
					}
				}
			},
            enumerable: false
		});
		Object.defineProperty(object, 'onChange', {
			value(name, cb) {
                const changeCallbacks = dflt(object).changeCallbacks;

				if (!changeCallbacks[name]) {
					changeCallbacks[name] = [];
				}
				changeCallbacks[name].push(cb);
			},
            enumerable: false
		});
		Object.defineProperty(object, 'offChange', {
			value(name, callback) {
                const changeCallbacks = dflt(object).changeCallbacks;

				if (changeCallbacks[name]) {
					if (callback === 'clear') {
						changeCallbacks[name] = [];
					} else if (callback instanceof Function) {
						const index = changeCallbacks[name].indexOf(callback);

						if (index !== -1) {
							changeCallbacks[name].splice(index, 1);
						} else {
							return;
						}
					}
				}
			},
            enumerable: false
		});

		Object.defineProperty(object.prototype, 'onChange', {
			value(name, cb) {
                const storeData = data(this);

				if (!storeData.localChangeCallbacks[name]) {
					storeData.localChangeCallbacks[name] = [];
				}
				storeData.localChangeCallbacks[name].push(cb);
			},
            enumerable: false
		});
		Object.defineProperty(object.prototype, 'offChange', {
			value(name, callback) {
                const storeData = data(this);

				if (storeData.localChangeCallbacks[name]) {
					const callbacks = storeData.localChangeCallbacks;

					if (callback === 'clear') {
						callbacks[name] = [];
					} else if (callback instanceof Function) {
						const index = callbacks.indexOf(callback);

						if (index !== -1) {
							callbacks[name].splice(index, 1);
						} else {
							return;
						}
					}
				}
			},
            enumerable: false
		});

        Object.defineProperty(object.prototype, 'dissociate', {
			value(field) {
                if (field !== undefined) {
                    clearDependencies(this, field);
                    delete data(this).cache[field];
                } else {
                    for(let field in dflt(object).fieldTypes) {
                        this.dissociate(field);
                    }
                }
			},
            enumerable: false
		});
	}
}

function spread(object) {
    const data = {};
    const classData = dflt(object.__proto__.constructor);

    for(let field in classData.fieldTypes) {
        if (classData.fieldTypes[field] !== Fields.method) {
            data[field] = object[field];
        }
    }

    return data;
}

function change(object, field) {
    const storeData = data(object);

    if (!storeData.isHandledChange[field]) {
        storeData.isHandledChange[field] = true;

        let subs;

        if (storeData.subscribers[field]) {
            subs = storeData.subscribers[field];
            clearDependencies(object, field);
        }

        if (field in storeData.cache) {
            delete storeData.cache[field];
        }

        setSyncTask(() => {
            const changeCallbacks = dflt(object.__proto__.constructor).changeCallbacks;

            if (changeCallbacks[field]) {
                changeCallbacks[field].forEach(cb => cb.apply(object));
            }

            if (storeData.localChangeCallbacks[field]) {
                storeData.localChangeCallbacks[field].forEach(cb => cb.apply(object));
            }
        }, 0);

        setSyncTask(() => {
            storeData.isHandledChange[field] = false;
        }, 1);

        if (subs) {
            subs.forEach(s => change(s.object, s.field));
        }
    }
}

function watch(object, watcherName) {
    getStack.push({ object, field: watcherName });
}

function unwatch() {
    getStack.pop();
}

function initStore(object) {
    const classData = dflt(object.__proto__.constructor);

    for(let field of classData.configuredFields) {
        delete object[field];
    }

    for(let field in classData.dependenciesTest) {
        watch(object, field);
        classData.dependenciesTest[field].apply(object);
        unwatch();
    }
    for(let field in classData.initedStart) {
        object[field]();
    }
}

function configure(object, config = object.storeConfig) {
    if (object.__proto__.constructor === Object) {
        const result = {};
        const dissociates = [];
        const descriptors = Object.getOwnPropertyDescriptors(object);

        for(let prop in descriptors) {
            if (value in descriptors[prop]) {
                if (descriptors[prop].value instanceof Function) {
                    result[prop] = descriptors[prop].value;
                } else {
                    const [ getValue, setValue, dissociate ] = value(descriptors[prop].value);

                    Object.defineProperty(result, prop, { get: getValue, set: setValue });
                    dissociates.push(dissociate);
                }
            } else if (descriptors[prop].get || descriptors[prop].set) {
                const [ getComputed, setComputed, dissociate ] = computed(descriptors[prop].get, descriptors[prop].set);

                Object.defineProperty(result, prop, { get: getComputed, set: setComputed });
                dissociates.push(dissociate);
            }
        }

        result.dissociate = function() {
            dissociates.forEach(dissociate => dissociate());
        };

        return result;
    }
    if (object instanceof Array) {
        const [ _, __, dissociate ] = value(object);

        object.dissociate = dissociate;

        return innerWathcer(hiddenStore, object, (callbackCount - 1).toString());
    }
    if (!config) {
        if (object.__proto__.constructor.isStorable && object.__proto__.constructor[AutoConfig]) {
            config = object.__proto__.constructor[AutoConfig];
        } else {
            config = object.__proto__.constructor[AutoConfig] = { reactive: {}, computed: {}, methods: {} };

            const props = Object.getOwnPropertyDescriptors(object);
            const computedAndMethods = Object.getOwnPropertyDescriptors(object.__proto__);

            for(let prop in props) {
                if (props[prop].value instanceof Object || props[prop].value === Waiting) {
                    config.reactive[prop] = { default() { return this[prop] }, isFactory: true };
                } else {
                    config.reactive[prop] = { default: props[prop].value };
                }
            }
            for(let prop in computedAndMethods) {
                if (computedAndMethods[prop].value && computedAndMethods[prop].value instanceof Function) {
                    config.methods[prop] = { method: computedAndMethods[prop].value };
                } else {
                    config.computed[prop] = { getter: computedAndMethods[prop].get, setter: computedAndMethods[prop].set };
                }
            }
        }
    }

    storable(object.__proto__.constructor, {
        updateImmediately: object.__updateImmediately ||object.__proto__.constructor.__updateImmediately
    });

    const checkSymbol = Symbol.for(config);
    const classData = dflt(object.__proto__.constructor);

    if (classData.configSymbols.indexOf(checkSymbol) === -1) {
        classData.configSymbols.push(checkSymbol);

        const cfg = { methods: {}, reactive: {}, computed: {} };

        if (config.reactives) {
            for(let reactive of config.reactives) {
                const descriptor = Object.getOwnPropertyDescriptor(object, reactive);

                cfg.reactive[reactive] = descriptor.value;

                delete object[reactive];
            }
        }

        if (config.reactive) {
            for(let reactive in config.reactive) {
                const descriptor = Object.getOwnPropertyDescriptor(object, reactive);

                cfg.reactive[reactive] = config.reactive[reactive] instanceof Object ? {
                    ...config.reactive[reactive],
                    default: config.reactive[reactive].default || descriptor.value
                } : config.reactive[reactive];

                delete object[reactive];
            }
        }

        if (config.computed) {
            for(let computed in config.computed) {
                const descriptor = Object.getOwnPropertyDescriptor(object.__proto__, computed);

                cfg.computed[computed] = config.computed[computed] instanceof Function ? config.computed[computed] : (
                    config.computed[computed] instanceof Object ? {
                    ...config.computed[computed],
                    getter: config.computed[computed].getter || descriptor.get,
                    setter: config.computed[computed].setter || descriptor.set
                } : {
                    getter: descriptor.get,
                    setter: descriptor.set
                });

                delete object[computed];
            }
        }

        if (config.methods) {
            for(let method in config.methods) {
                const descriptor = Object.getOwnPropertyDescriptor(object.__proto__, method);

                cfg.methods[method] = config.methods[method] instanceof Function ? config.methods[method] : (
                    config.methods[method] instanceof Object ? {
                    ...config.methods[method],
                    method: config.methods[method].method || descriptor.value,
                } : descriptor.value);

                classData.configuredFields.push(method);
                delete object[method];
            }
        }

        object.__proto__.constructor.configure(cfg);
    }

    initStore(object);
}

function clearDependencies(object, field) {
    _clearDependencies(object, field);

    if (dflt(object.__proto__.constructor).fieldTypes[field] === Fields.reactive) {
        const storeData = data(object);
        const reg = new RegExp(`^${field}\\.`);

        for(let subField in storeData.subscribers) {
            if (reg.test(subField)) {
                _clearDependencies(object, subField);
            }
        }
        for(let subField in storeData.dependencies) {
            if (reg.test(subField)) {
                _clearDependencies(object, subField);
            }
        }
    }
}

function _clearDependencies(object, field) {
    if (dflt(object.__proto__.constructor).fieldTypes[field]) {
        const storeData = data(object);

        if (storeData.subscribers[field]) {
            storeData.subscribers[field].forEach(sub => {
                const subObject = sub.object;
                const prop = sub.field;
                const subData = data(subObject);
                const index = subData.dependencies[prop].findIndex(dep => dep.field === field && dep.object === object);

                if (index !== -1) {
                    subData.dependencies[prop].splice(index, 1);
                }
            });
            delete storeData.subscribers[field];
        }
        if (storeData.dependencies[field]) {
            storeData.dependencies[field].forEach(dep => {
                const depObject = dep.object;
                const prop = dep.field;
                const depData = data(depObject);
                const index = depData.subscribers[prop].findIndex(sub => sub.field === field && sub.object === object);

                if (index !== -1) {
                    depData.subscribers[prop].splice(index, 1);
                }
            });
            delete storeData.dependencies[field];
        }
    }
}


// Helpers

function isImmediately(value) {
    return (value instanceof Object && value[ImmediateValue]);
}

function isDeferredly(value) {
    return (value instanceof Object && value[DeferredValue]);
}

function addconfiguredField(cls, field, type) {
    if (dflt(cls).configuredFields.indexOf(field) === -1) {
        dflt(cls).configuredFields.push(field);
    }

    dflt(cls).fieldTypes[field] = type;
}

const arrayMutationMethods =  [ 'push', 'pop', 'shift', 'unshift', 'splice' ];

function isArrayMutationMethod(field) {
    return arrayMutationMethods.indexOf(field) !== -1;
}

// /Helpers

// Classless methods

function value(value) {
    const field = (callbackCount++).toString();

    HiddenStore.configure({
		reactive: {
			[field]: {
				default: value
			}
		}
	});

    return [ () => hiddenStore[field], (value) => hiddenStore[field] = value, () => hiddenStore.dissociate(field) ];
}

function computed(getter, setter) {
    const field = (callbackCount++).toString();

    HiddenStore.configure({
		computed: {
			[field]: {
				getter, setter
			}
		}
	});

    return [ () => hiddenStore[field], (value) => hiddenStore[field] = value, () => hiddenStore.dissociate(field) ];
}

function callback(callback, dependencies, proxyCallback, config = {}) {
	const field = (callbackCount++).toString();

	HiddenStore.configure({
		methods: {
			[field]: {
				method: callback,
                callback: proxyCallback,
				autoExec: true,
                dependencies,
                context: hiddenStore
			}
		}
	});

    if (dependencies) {
        watch(hiddenStore, field);
        dependencies();
        unwatch();
    } else if (config.initedStart) {
    	hiddenStore[field]();
    }

	return [
        function(...args) {
            return hiddenStore[field].apply(this, args);
        },
        () => {
            HiddenStore.offChange(field, hiddenStore[field]);
            HiddenStore.offChange(field, proxyCallback);
            clearDependencies(hiddenStore, field);
        }
    ];
}

// /Classless methods

// Async methods

function asyncWatcher(fn) {
	const currentDependency = getStack[getStack.length - 1];

	if (currentDependency) {
		return (...args) => {
			getStack.push(currentDependency);

			const result = fn.apply(currentDependency.object, args);

			getStack.pop();

			return result;
		};
	} else {
		Throw(new Error('asyncWatcher must be called into getter or autoExec methods'));
	}
}

function waiting(actionFunction) {
    const stacked = getStack[getStack.length - 1];

    let cancelAction;

    const put = (value) => {
        if (!resultObject[WaitingCanceled]) {
            if (stacked) {
                data(stacked.object).cache[stacked.field] = value;
                data(stacked.object).subscribers[stacked.field].forEach(sub => {
                    change(sub.object, sub.field);
                }); 
                execSyncTasks();
            } else if (resultObject[WaitingPoint]) {
                point = resultObject[WaitingPoint];
                resultObject[WaitingPoint].object[resultObject[WaitingPoint].field] = { isPut: true, value };
            }
        }
    };

    if (actionFunction instanceof Function) {
        cancelAction = actionFunction.apply(stacked ? stacked.object : undefined, [put]);
    }

    const resultObject = { [Waiting]: true, [CancelAction]: cancelAction instanceof Function ? cancelAction : undefined };

    put[Waiting] = true;
    resultObject.put = put;

    return resultObject;
}

// /Async methods

// Waiting check

function someIsWaiting(...args) {
    for(let arg of args) {
        if (arg === Waiting) {
            return true;
        }
    }

    return false;
}

function allIsWaiting(...args) {
    for(let arg of args) {
        if (arg !== Waiting) {
            return false;
        }
    }

    return true;
}

// /Waiting check

// Value modificators

function hush(value) {
    return { [Hush]: true , [Value]: value };
}

function immediate(value) {
    return { [ImmediateValue]: true, [Value]: value };
}

function deferred(value) {
    return { [DeferredValue]: true, [Value]: value };
}

function asDependency(object) {
    return hiddenStore[object[HiddenStoreField]];
}

// /Value modificators

// Task management

function setTask(object, field, value, preSetter) {
    const similarTask = setTasks.find(task => task.object === object && task.field === field);

    if (similarTask) {
        similarTask.value = value;
		if (preSetter) {
			if (similarTask.preSetters) {
				similarTask.preSetters.push(preSetter);
			} else {
				similarTask.preSetters = [ preSetter ];
			}
		}
    } else {
        setTasks.push({ object, field, value, preSetters: preSetter ? [ preSetter ] : undefined });
    }

    if (!isSettersLaunched) {
        timeoutFunction(execTask);

        isSettersLaunched = true;
    }
}

function execTask() {
    const tasks = [...setTasks];

    setTasks.splice(0);
    isSettersLaunched = false;

    tasks.forEach(({ object, field, value, preSetters }) => {
        const storeData = data(object);

		if (preSetters) {
			preSetters.forEach(cb => cb());
		}

        if (value !== NoValue) {
            storeData.values[field] = value;
        }
    });
    tasks.forEach(({ object, field }) => {
        change(object, field);
    });
    execSyncTasks();
}

function setSyncTask(task, priority) {
    if (!syncTasks[priority]) {
        syncTasks[priority] = [];
    }

    syncTasks[priority].push(task);
}

function execSyncTasks() {
    syncTasks.forEach(tasks => {
        if (tasks) {
            tasks.forEach(task => {
                task();
            });

            tasks.splice(0);
        }
    });
}

// /Task management

// Behavior methods

function useTimeoutFunction(fn) {
    if (fn instanceof Function) {
        timeoutFunction = fn;
    } else if(nf === null) {
        timeoutFunction = setTimeout;
    } else {
        throw new Error('Timeout function must be instanceof a Function or null to reset to setTimeout');
    }
}

// /Behavior methods

// Dev helpers

function Throw(error) {
    if (DevHelper) {
        DevHelper.error(error);
    }
    
    throw error;
}

function useDevHelper(devHelper) {
    DevHelper = devHelper;

    throw 'Blank function useDevHelper';
}

// Dev helpers

module.exports = {
    storable,
    init: initStore,
    asyncWatcher,
    callback,
    useDevHelper,
    configure,
    immediate,
    deferred,
    hush,
    useTimeoutFunction,
    value,
    computed,
    waiting,
    someIsWaiting,
    allIsWaiting,
    asDependency,
    spread,
    Waiting
};