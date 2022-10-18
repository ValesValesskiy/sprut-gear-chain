const getStack = [];
const setTasks = [];
const syncTasks = [];
let isSettersLaunched = false;
let DevHelper;

const StoreData = Symbol('storeData');
const Default = Symbol('default');
const ImmediateValue = Symbol('immediateValue');
const DeferredValue = Symbol('deferredValue');
const AutoConfig = Symbol('autoConfig');
const Waiting = Symbol('waiting');
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
            isFactory: {}
        };
    }
}

function data(object) {
    if (!object[StoreData]) {
        object[StoreData] = { subscribers: {}, cache: {}, values: {}, localChangeCallbacks: {}, isHandledChange: {}, dependencies: {}, initedReactive: {} };
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
            storeData.values[field] = defaultValue.apply(this);
        } else {
            storeData.values[field] = defaultValue;
        }

        storeData.initedReactive[field] = true;
    }
}

function isImmediately(value) {
    return (value instanceof Object && ImmediateValue in value);
}

function isDeferredly(value) {
    return (value instanceof Object && DeferredValue in value);
}

function _reactive(cls, field, def, onSet, updateImmediately, isFactory) {
	dflt(cls).values[field] = def;

    addconfiguredField(cls, field);

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

            initReactive(this, field);

			if (!storeData.subscribers[field]) storeData.subscribers[field] = [];

			const stacked = getStack[getStack.length - 1];

            if (stacked) {
                const stackedData = data(stacked.object);
            
                if (!stackedData.dependencies[stacked.field]) stackedData.dependencies[stacked.field] = [];
                if (!storeData.subscribers[field].find(s => s.field === stacked.field && s.object === stacked.object)) {
                    storeData.subscribers[field].push(getStack[getStack.length - 1]);
                    stackedData.dependencies[stacked.field].push({ object: this, field });
                }
            }

            let value = storeData.values[field];

			if (value instanceof Object && !value.__proto__.constructor.isStorable) {
				return innerWathcer(this, value, field);
			}

			return value;
		},
		set(v) {
            const storeData = data(this);

            initReactive(this, field);

			if(v && v.hush) {
				storeData.values[field] = v.value;
			} else {
				const prev = storeData.values[field];
                const isImmediate = isImmediately(v);
                const isDeferred = isDeferredly(v);
				let newV = isImmediate ? v[ImmediateValue] : (isDeferred ? v[DeferredValue] : v);

				if(onSet instanceof Function) {
					let setRes = onSet.apply(this, [prev, newV]);

					newV = setRes !== undefined ? setRes : newV;
				}
				if (newV !== prev) {
                    if (!isDeferred && (isImmediate || dflt(cls).updateImmediately[field])) {
					    storeData.values[field] = newV;

					    this.change(field);
                        execSyncTasks();
                    } else {
                        setTask(this, field, newV);
                    }
				}
			}
		},
        configurable: true
	})
}

function innerWathcer(that, object, field) {
	return new Proxy(object, {
		get(target, prop) {
            if (isArrayMutationMethod(prop)) {
                return arrayMutationMethod(prop, that, object, field);
            } else if (prop in target && target[prop] instanceof Object && Object.hasOwnProperty(target, prop)) {
				return innerWathcer(that, target[prop], field);
			}

			return target[prop];
		},
		set(target, prop, val) {
			if (target[prop] !== val) {
                const isImmediate = isImmediately(val);
                const isDeferred = isDeferredly(val);
                const value = isImmediate ? val[ImmediateValue] : (isDeferred ? val[DeferredValue] : val);

                if (!isDeferred && (isImmediate || dflt(that.__proto__.constructor).updateImmediately[field])) {
				    target[prop] = value;
				    that.change(field);
                    execSyncTasks();
                } else {
                    setTask(that, field, data(that).values[field], () => target[prop] = value);
                }
			}

			return true;
		}
	});
}

const arrayMutationMethods =  [ 'push', 'pop', 'shift', 'unshift', 'splice'];

function isArrayMutationMethod(field) {
    return arrayMutationMethods.indexOf(field) !== -1;
}

function arrayMutationMethod(method, that, object, field) {
    return function(...args) {
        if (dflt(that.__proto__.constructor).updateImmediately[field]) {
            Array.prototype[method].apply(this, args);
            that.change(field);
            execSyncTasks();
        } else {
            setTask(that, field, data(that).values[field], () => Array.prototype[method].apply(this, args));
        }

        return Array.prototype[method].apply([...this], args);
    }
};

function _computed(cls, field, getter, setter) {
    addconfiguredField(cls, field);

	Object.defineProperty(cls.prototype, field, {
		get() {
            const storeData = data(this);

			if (!storeData.subscribers[field]) storeData.subscribers[field] = [];
            if (!storeData.dependencies[field]) storeData.dependencies[field] = [];

			const stacked = getStack[getStack.length - 1];

            if (stacked) {
                const stackedData = data(stacked.object);

                if (!stackedData.dependencies[stacked.field]) stackedData.dependencies[stacked.field] = [];
                if (!storeData.subscribers[field].find(s => s.field === stacked.field && s.object === stacked.object)) {
                    storeData.subscribers[field].push(getStack[getStack.length - 1]);
                    stackedData.dependencies[stacked.field].push({ object: this, field });
                }
            }

			if (storeData.cache[field]) {
				return storeData.cache[field];
			}

			watch(this, field);

			const result = getter.apply(this);

			storeData.cache[field] = result;

			unwatch();

			return result;
		},
        set(v) {
            if (setter) {
                setter.apply(this, [v]);
            } else {}
        },
        configurable: true
	});
}

function _method(cls, field, methodConfig) {
    const classData = dflt(cls);

    addconfiguredField(cls, field);

	if (methodConfig.callback || methodConfig.autoExec) {
		const method = methodConfig.method || cls.prototype[field];

		Object.defineProperty(cls.prototype, field, {
			value(...args) {
				watch(this, field);
				const res = method.apply(this, args);
				unwatch();
		
				return res;
			},
            configurable: true
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
					value: methodConfig.method.bind(this)
				});
			
				return this[field];
			},
            configurable: true
		});
	} else {
		Object.defineProperty(cls.prototype, field, {
			value: methodConfig.method,
            configurable: true
		});
	}
}

function storable(object, config = {}) {
	if (!object.isStorable) {
		object.isStorable = true;

        init(object);

        const { updateImmediately = false } = config;
        const classData = dflt(object);

        classData.config.updateImmediately = updateImmediately;

		Object.defineProperty(object, 'computed', {
			value: function(field, getter, setter) {
				_computed(this, field, getter, setter);
			}
		});
		Object.defineProperty(object, 'reactive', {
			value: function(field, def, onSet, updateImmediately, isFactory) {
                _reactive(this, field, def, onSet, updateImmediately, isFactory);
			}
		});
        Object.defineProperty(object, 'method', {
			value: function(field, methodConfig) {
                _method(this, field, methodConfig);
			}
		});
		Object.defineProperty(object, 'configure', {
			value: function({ reactive, methods, computed } = {}) {
				for(let field in reactive) {
					this.reactive(field, reactive[field] && reactive[field].default || reactive[field], reactive[field] && reactive[field].setter || null, reactive[field] && reactive[field].immediate, reactive[field] && reactive[field].isFactory);
				}
				for(let field in computed) {
					this.computed(field, computed[field] instanceof Function ? computed[field] : computed[field] && computed[field].getter || null, computed[field] && computed[field].setter || null);
                }
				for(let field in methods) {
					if (methods[field]) {
                        this.method(field, methods[field]);
					}
				}
			}
		});
		Object.defineProperty(object, 'onChange', {
			value(name, cb) {
                const changeCallbacks = dflt(object).changeCallbacks;

				if (!changeCallbacks[name]) {
					changeCallbacks[name] = [];
				}
				changeCallbacks[name].push(cb);
			}
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
			}
		});

		Object.defineProperty(object.prototype, 'onChange', {
			value(name, cb) {
                const storeData = data(this);

				if (!storeData.localChangeCallbacks[name]) {
					storeData.localChangeCallbacks[name] = [];
				}
				storeData.localChangeCallbacks[name].push(cb);
			}
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
			}
		});

		Object.defineProperty(object.prototype, 'change', {
			value(field) {
                const storeData = data(this);

                if (!storeData.isHandledChange[field]) {
                    storeData.isHandledChange[field] = true;

                    let subs;

                    if (storeData.subscribers[field]) {
                        subs = storeData.subscribers[field];
                        storeData.subscribers[field] = [];
                    }

                    if (storeData.cache[field]) {
                        delete storeData.cache[field];
                    }

                    setSyncTask(() => {
                        const changeCallbacks = dflt(object).changeCallbacks;

                        if (changeCallbacks[field]) {
                            changeCallbacks[field].forEach(cb => cb.apply(this));
                        }

                        if (storeData.localChangeCallbacks[field]) {
                            storeData.localChangeCallbacks[field].forEach(cb => cb.apply(this));
                        }
                    }, 0);

                    setSyncTask(() => {
                        storeData.isHandledChange[field] = false;
                    }, 1);

                    if (subs) {
                        subs.forEach(s => s.object.change(s.field));
                    }
                }
			}
		});
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
    if (!config) {
        if (object.__proto__.constructor.isStorable && object.__proto__.constructor[AutoConfig]) {
            config = object.__proto__.constructor[AutoConfig];
        } else {
            config = object.__proto__.constructor[AutoConfig] = { reactive: {}, computed: {}, methods: {} };

            const props = Object.getOwnPropertyDescriptors(object);
            const computedAndMethods = Object.getOwnPropertyDescriptors(object.__proto__);

            for(let prop in props) {
                config.reactive[prop] = { defult: props[prop].value };
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

                cfg.computed[computed] = config.computed[computed] instanceof Function ? cfconfigg.computed[computed] : (
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
    } else {
        for(let field of classData.configuredFields) {
            delete object[field];
        }
    }

    initStore(object);
}

function addconfiguredField(cls, field) {
    if (dflt(cls).configuredFields.indexOf(field) === -1) {
        dflt(cls).configuredFields.push(field);
    }
}

function callback(callback, dependencies) {
	const field = callbackCount++;

	HiddenStore.configure({
		methods: {
			[field]: {
				method: callback,
				autoExec: true,
                dependencies
			}
		}
	});

    if (dependencies) {
        watch(hiddenStore, field);
        dependencies();
        unwatch();
    } else {
    	hiddenStore[field]();
    }

	return () => {HiddenStore.offChange(field, hiddenStore[field])};
}

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

function waiting() {
    const stacked = getStack[getStack.length - 1];

    if (!stacked) {
        throw new Error('No getter in progress');
    }

    const result = (value) => {
        data(stacked.object).cache[stacked.field] = value;
        data(stacked.object).subscribers[stacked.field].forEach(sub => {
            sub.object.change(sub.field);
        });
        execSyncTasks();
    };

    return result;
}

function immediate(value) {
    return { [ImmediateValue]: value };
}

function deferred(value) {
    return { [DeferredValue]: value };
}

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

        storeData.values[field] = value;
    });
    tasks.forEach(({ object, field }) => {
        object.change(field);
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

function useTimeoutFunction(fn) {
    if (fn instanceof Function) {
        timeoutFunction = fn;
    } else if(nf === null) {
        timeoutFunction = setTimeout;
    } else {
        throw new Error('Timeout function must be instanceof a Function or null to reset to setTimeout');
    }
}

// Functions

function value(value) {
    const field = callbackCount++;

    HiddenStore.configure({
		reactive: {
			[field]: {
				default: value
			}
		}
	});

    return [ () => hiddenStore[field], (value) => hiddenStore[field] = value ];
}

function computed(getter, setter) {
    const field = callbackCount++;

    HiddenStore.configure({
		computed: {
			[field]: {
				getter, setter
			}
		}
	});

    return [ () => hiddenStore[field], (value) => hiddenStore[field] = value ];
}

module.exports = { storable,  asyncWatcher, callback, useDevHelper, init: initStore, configure, immediate, deferred, data, useTimeoutFunction, value, computed, waiting, Waiting };