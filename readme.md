<br>
<br>
<p align="center"><img src="./icon.svg" width="150"></p>
<br>
<br>

```
> npm i sprut-gear-chain
```

# Sprut-gear-chain

<span style="color: #cc5555">Инструмент тестируется и будет дописываться или переписываться.</span>

<span style="color: #cc5555">До версии 1.0.0 интерфейсы некоторых методов могут отличаться от релиза к релизу.</span>

<span style="color: #cc5555">Прошу понять и простить.</span>

Инструмент управления состоянием данных.
Упрощает слежение за изменениями данных и создание реакции на изменения. По результату и использованию похоже на mobX. Конфигурация происходит на уровне прототипа с минимальными действиями во время работы с данными. По крайней мере такой была попытка. Писалось в целях обучения, эксперимента, для нужд собственных разработок и из принципа.
Типизацию пока не доробатывал.

---

<br>

## Быстрое использование:

<br>

```js
const { configure, callback } = require('sprut-gear-chain');

class Store {
    constructor() {
        configure(this);
    }

    reactiveProp = 1;
}

const store = new Store();

callback(() => console.log(store.reactiveProp), () => store.reactiveProp);
store.reactiveProp++; // В логе выведет 2
```

```configure(object, config?)``` модифицирует прототип объекта при создании первого экземпляра. В последующих созданиях экземпляров выполняет минимум действий по донастройке объекта с уже модифицированным прототипом.
Метод также предполагает использование конфига вторым аргументом и также может подобрать конфиг из свойства объекта ```.storeConfig```.
При использовании без конфига модифицирует все свойства, которые найдёт в объекте и прототипе. Геттеры и сеттеры преобразовывает в ```computed``` свойства, а значения в ```reactive``` свойства.

<br>

## В функциональном стиле и пример с использованием ожидания:

<br>

```js
const { value, computed, waiting, someIsWaiting } = require('sprut-gear-chain');

const [ getValue, setValue ] = value('value');
const [ getComputed, setComputed ] = computed(() => {
    const result = getValue() + ' is reactive';

    return waiting((put) => {
        const timeout = setTimeout(() => put(result), 1000);

        return () => clearTimeout(timeout);
    });
}, () => { /* setter */ });

const [ exec, dissociate ] = callback(() => {
    if (!someIsWaiting(getComputed())) {
        console.log(getComputed());
    } else {
        console.log('waiting');
    }
}, () => getComputed());

setTimeout(() => {
    setValue('new value');
}, 5000);

// Лог выведет
// value is reactive
// waiting
// new value is reactive
```

```put``` удастся использовать до следующего изменения, после чего он отключится. Также будет вызвана функция, если таковая возвращалась из функции, вброшенной в ```waiting()```. Можно использовать для отключения ожидающих реакций. ```put``` до момента отключения можно использовать множество раз. При изменении будет создан новый и старые и новые не будут пересекаться и перебивать друг друга.

<br>

Также ```waiting()``` можно использовать как инициализирующее значение для ```reactive``` полей класса(обычных значений) и в фукнции ```value()``` при создании значения.

<br>

## Аналог configure:

<br>

Вместо использования конфига и метода ```configure()``` возможно использовать похожий вариант конфигурации без автоматической кофигурации.
Для корректной работы нужно вызвать ```init(this)``` в конструкторе. Он также вызывается внутри ```configure()``` из предыдущих примеров.

```js
const { storable, init } = require('sprut-gear-chain');

class Store {
    constructor() {
        init(this);
    }
}

storable(Store);

Store.configure({
    reactive: {
        prop: {
            default: 'default value',
            immediate: true
        },
        prop_2: {
            default: () => new EventTarget(),
            isFactory: true
        }
    },
    methods: {
        methodName: {
            method() {
                console.log(this.prop);
                this.prop_2.dispathEvent(new Event('event'));
            },
            autoExec: true,
            initedStart: true
        }
    }
});
```

<br>

## Пример использования с конфигом:

<br>

```js
const { configure } = require('sprut-gear-chain');

const config = {
    reactives: ['reactiveProp'],
    reactive: {
        immediateProp: {
            immediate: true
        }
    },
    methods: {
        autorunMethod: {
            autoExec: true,
            dependencies() {
                this.immediateProp;
                this.reactiveProp;
            }
        }
    }
};

class Store {
    storeConfig = config;

    constructor() {
        configure(this);
    }

    reactiveProp = 1;

    immediateProp = 'prop';

    autorunMethod() {
        console.log('immediateProp = ', this.immediateProp, ', reactiveProp =', this.reactiveProp);
    }
}

const store = new Store();

store.reactiveProp++;
store.immediateProp = 'value';
// Лог:
// immediateProp = value, reactiveProp = 1
// immediateProp = value, reactiveProp = 2

```

Такой лог будет выведен из-за того, что одно из свойств является ```immediate: true```.
При изменении данных все изменения и методы отрабатывают один раз через короткий промежуток времени, в следующем фрейме или по таймауту. Таким образом состояние хранилищ остаётся тем же, и данные будут браться из кеша или расчитываться при запросе данных из геттеров или реактивных свойств.

Но если использовать ```immediate``` поля или применять модификаторы поведения ```immediate(value)``` или ```deferred(value)``` поведение будет отличаться.

Например:

```js
store.reactiveProp++;
store.immediateProp = deferred('value')
// Лог:
// immediateProp = value, reactiveProp = 2
```

<br>

```deferred``` - модификатор заставляет дождаться общего выполнения задач по изменению данных вне зависимости от настроек.

```immediate``` - модификатор заставялет сразу выполнить применение значения вне зависимости от настроек.

По умолчанию значения применяются не сразу. Но можно заставить все поля изменяться сразу прописав такую настройку:

```js
class Store {
    static __updateImmediately = true;
```

Либо:

```js
class Store {
    __updateImmediately = true;
```

Либо:

```js
class Store {
    constructor() {
        this.__updateImmediately = true;
    }
```

## Отсоединение хранилища от зависимостей:

<br>

```js
store.dissociate(propName);
```

Такой вариант уничтожит зависимости для конкретного поля.

Чтобы уничтожить зависимости на всех полях следует использовать тот же метод без аргументов:

```js
store.dissociate();
```

Это необходимо делать, когда подразумевается уничтожение хранилища или состояния.

<br>

## Таймаут функция:

<br>
Также можно задать таймаут-функцию для отложенного обновления. По умолчанию это ```setTimeout``` с нулевым интервалом. Но можно закинуть и ```requestAnimationFrame```, если вы в браузере либо в ```electron```, например:

```js
const { useTimeoutFunction } = require('sprut-gear-chain');

useTimeoutFunction(requestAnimationFrame);
```

<br>

## Использование asyncWatcher:

<br>

```asyncWatcher``` отслеживает зависимости в асинхронной функции. ```asyncWatcher``` должен быть вызван внутри отслеживаемого метода или фукнции в ```callback```. Оборачивает функцию.

Например:

```js
callback(() => {
    setTimeout(asyncWatcher(() => console.log(store.reactiveProp)), 50);
}, () => store.reactiveProp);
```

Вторым аргументом в ```callback``` применяется функция для исследования зависимостей. В дальнейшем зависимости будут исследовать при выполнении автоматически запускаемых методов. Если не указана функция для исследования зависимостей, метод может быть запущен с самого начала автоматически. Третьим аргументом может быть прокси-функция, которая будет вызвана после изменений зависимостей.
Таким образом можно наблюдать за зависимостями какого-то метода и запускать механизм использующим данный метод. Например функции или методы рендера компонентов. А через прокси запускать перерендер этих компонентов.
Например:

```js
const [ getValue, setValue ] = value(0);
const view = (...props) => getValue().toString() + ', ' + props.join(', ') + '.';
const someProps = [ 'prop_1', 'prop_2', 'prop_3' ];
const render = () => {
    console.log(observerVeiw(...someProps));
};
const [ observerVeiw, dissociate ] = callback(view, undefined, render, { initedStart: true });

setValue(1);
```

В классах, если метод переопределяется как наблюдаель, метод автоматически будет реагировать на изменения своих зависимостей. В случае ```callback()``` он сам возвращает обёрнутую функцию и использовать для дальнейшего наблюдения зависимостей следует именно её,, как в примере выше, так как зависимости в разных условиях могут изменяться.

В сущности callback-фукнция является методом скрытого стора.

<br>

## Модификатор значения hush:

<br>

Используется, чтобы положить значение в ```reactive``` поле без вызова реакций. Следует класть любое значение, кроме модифицированных одним из модификаторов поведения.

```js
const { hush } = require('sprut-gear-chain');

store.reactiveProp = hush('value');
```

<br>

Описаны не все особенности. Некоторое из неописанного, возможно, будет выпилено.