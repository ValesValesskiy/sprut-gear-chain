<br>
<br>
<div style="text-align: center"><img src="./icon.svg" width="150"></div>
<br>
<br>

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
const [ getComputed ] = computed(() => {
    const result = getValue() + ' is reactive';

    return waiting((put) => {
        const timeout = setTimeout(() => put(result), 1000);

        return () => clearTimeout(timeout);
    });
});

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

Но если использовать ```immediate``` поля или применять специальные значния ```immediate(value)``` или ```deferred(value)``` поведение будет отличаться.

Например:

```js
store.reactiveProp++;
store.immediateProp = deferred('value')
// Лог:
// immediateProp = value, reactiveProp = 2
```

<br>

```deferred``` - заставляет дождаться общего выполнения задач по изменению данных вне зависимости от настроек.

```immediate``` - заставялет сразу выполнить применение значения вне зависимости от настроек.

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

Вторым аргументом в ```callback``` применяется функция для исследования зависимостей. В дальнейшем зависимости будут исследовать при выполнении автоматически запускаемых методов. Если не указана функция для исследования зависимостей, метод будет запущен с самого начала автоматически. Сейчас это пока не регулируется.

В сущности callback-фукнция является методом скрытого стора.

Описаны не все особенности. Некоторое из неописанного, возможно, будет выпилено.