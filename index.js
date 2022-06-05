const ccxt = require('ccxt')
const moment = require('moment')
const delay = require('delay')
const dotenv = require('dotenv')
const telegramBot = require('node-telegram-bot-api');

// config env
dotenv.config()

const bot = new telegramBot(process.env.TELEGRAM, { polling: true });
var messageId = null
var messageToSend = ''

// cons
const SYMBOL = 'GMT/USDT'
const ENABLE_TRADE = true
const LEVERAGE = 10 // lever in 1x to 125x
const DELAY = 3000 // 3s
const TIME = {
    oneMinute: '1m',
    oneHour: '1h',
    fourHour: '4h'
}

const COUNT_DATA = {
    oneMinute: 1 * 60, // 1 hour
    oneHour: 1 * 24, // 1 day
    fourHour: 1 * 6 * 3 // 3 day
}

const MARGINTYPE = {
    cross: 'CROSSED',
    isolated: 'ISOLATED'
}

const SIDE = {
    BUY: 'buy',
    SELL: 'sell'
}

const POSITION_SIDE = {
    LONG: 'LONG',
    SHORT: 'SHORT'
}

const PROFIT_TARGET = 0.5
const STOP_LOSS_TARGET = -0.3

// api key
const binanceExchange = new ccxt.binanceusdm({
    apiKey: process.env.APIKEY,
    secret: process.env.SECRET,
    options: {
        'defaultType': 'future'
    },
    rateLimit: true
});

async function getInfo() {
    // load markets and settings for trade
    const markets = await binanceExchange.loadMarkets()

    // select ${SYMBOL}
    const market = await binanceExchange.market(SYMBOL)

    // set leverage
    const setLeverage = await binanceExchange.fapiPrivatePostLeverage({
        'symbol': market.id,
        'leverage': LEVERAGE,
    })

    // set hedged mode
    try {
        const setHedgedMode = await binanceExchange.setPositionMode({
            'hedged': true,
            symbol: SYMBOL
        })
    } catch (error) {
        if (error instanceof ccxt.NetworkError) {
            log(`setHedgedMode failed due to a network error: ${error.message}`)
        } else if (error instanceof ccxt.ExchangeError) {
            log(`setHedgedMode failed due to exchange error: ${error.message}`)
        } else {
            log(`setHedgedMode failed with: ${error.message}`)
        }
    }

    // set marginType
    try {
        const setMarginType = await binanceExchange.fapiPrivatePostMarginType({
            'symbol': market.id,
            'marginType': MARGINTYPE.isolated
        })
    } catch (error) {
        if (error instanceof ccxt.NetworkError) {
            log(`setMarginType failed due to a network error: ${error.message}`)
        } else if (error instanceof ccxt.ExchangeError) {
            log(`setMarginType failed due to exchange error: ${error.message}`)
        } else {
            log(`setMarginType failed with: ${error.message}`)
        }
    }

    // get total usdt
    const balance = await binanceExchange.fetchBalance();
    const totalUSDT = balance.total.USDT
    log(`\n`)
    log(`Date: ${Date()}`)
    log(`Total USDT: ${totalUSDT}`)

    // analytics
    log(`\n`)
    const result1M = await analytics(SYMBOL, TIME.oneMinute, COUNT_DATA.oneMinute)
    const result1H = await analytics(SYMBOL, TIME.oneHour, COUNT_DATA.oneHour)
    const result4H = await analytics(SYMBOL, TIME.fourHour, COUNT_DATA.fourHour)

    // get positions
    const positions = balance.info.positions
    var hadPosition = false
    for (let i = 0; i < positions.length; i++) {
        const position = positions[i]
        // skip if current position is very small
        if (position.symbol == market.id && position.initialMargin > 1) {
            let unrealizedProfit = position.unrealizedProfit
            let positionSide = position.positionSide
            // condition to trigger take profit or stop loss action
            let takeProfit = unrealizedProfit >= PROFIT_TARGET
            let stopLoss = unrealizedProfit <= STOP_LOSS_TARGET
            log(`\n`)
            log(`Symbol: ${position.symbol} - Profit: ${unrealizedProfit} - EntryPrice: ${position.entryPrice} - Position Side: ${positionSide} - Isolated: ${position.isolated} - Leverage: ${position.leverage}X`)
            log(`Symbol: ${position.symbol} - TakeProfit: ${takeProfit} - Profit Target: ${PROFIT_TARGET} - Stoploss: ${stopLoss} - Stoploss Target: ${STOP_LOSS_TARGET}`)
            hadPosition = true
            if (takeProfit || stopLoss) {
                const side = positionSide == POSITION_SIDE.LONG ? SIDE.SELL : SIDE.BUY
                log(`\n`)
                await order('close', position.initialMargin * position.leverage, side, positionSide)
            }
            break
        }
    }
    if (!hadPosition && ENABLE_TRADE) {
        const positionSideOrder = result1M.average > result1M.lastPrice ? POSITION_SIDE.SHORT : POSITION_SIDE.LONG
        const side = positionSideOrder == POSITION_SIDE.LONG ? SIDE.BUY : SIDE.SELL
        const amount = parseInt(0.95 * totalUSDT * LEVERAGE)
        log(`\n`)
        await order('open', amount, side, positionSideOrder)
    }
}

async function analytics(SYMBOL, time, COUNT) {
    const priceResponse = await binanceExchange.fetchOHLCV(SYMBOL, time, undefined, COUNT)
    const priceObject = priceResponse.map(price => {
        return {
            timestamp: moment(price[0]).format(),
            open: price[1],
            hight: price[2],
            low: price[3],
            close: price[4],
            volume: price[5]
        }
    })
    const hight = Math.max(...priceObject.map(e => e.hight))
    const low = Math.min(...priceObject.map(e => e.low))
    const lastPrice = priceObject[priceResponse.length - 1].close
    const average = (hight + low) / 2
    log(`Time: ${time} - Hight: ${hight} - Low: ${low} - Average: ${average} - Current: ${lastPrice}`)
    return { hight: hight, low: low, average: average, lastPrice: lastPrice }
}

async function order(type, amount, side, position_side) {
    try {
        log(`${type} order with ${SYMBOL} ${amount} ${side} ${position_side}`)
        const order = await binanceExchange.createOrder(SYMBOL, 'market', side, amount, undefined, { 'positionSide': position_side })
    } catch (error) {
        if (error instanceof ccxt.NetworkError) {
            log(`${type} order failed due to a network error: ${error.message}`)
        } else if (error instanceof ccxt.ExchangeError) {
            log(`${type} order failed due to exchange error: ${error.message}`)
        } else {
            log(`${type} order failed with: ${error.message}`)
        }
    }
}

function log(message) {
    messageToSend += message + '\n'
}

function sendLog() {
    if (messageId == null) {
        return
    }
    bot.sendMessage(messageId, messageToSend)
}

function clearLog() {
    messageToSend = ''
}

async function main() {
    bot.on('message', (msg) => {
        let startCommand = 'start'
        let endCommand = 'end'
        if (msg.text.toString().toLowerCase().indexOf(startCommand) === 0) {
            messageId = msg.chat.id
        }
        if (msg.text.toString().toLowerCase().indexOf(endCommand) === 0) {
            messageId = null
        }
    })
    while (true) {
        clearLog()
        await getInfo()
        await delay(DELAY)
        sendLog()
    }
}

main()