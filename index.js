const ccxt = require('ccxt')
const moment = require('moment')
const delay = require('delay')
const dotenv = require('dotenv')
const telegramBot = require('node-telegram-bot-api');

// pm2 start index.js
// pm2 stop index.js

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

const PROFIT_PRICE = 5 // 5%
const STOP_LOSS = 5 // 5%

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
    log(`Date: ${Date()}`)
    log(`Total USDT: ${totalUSDT}`)

    // analytics
    const result1M = await analytics(SYMBOL, TIME.oneMinute, COUNT_DATA.oneMinute)
    const result1H = await analytics(SYMBOL, TIME.oneHour, COUNT_DATA.oneHour)
    const result4H = await analytics(SYMBOL, TIME.fourHour, COUNT_DATA.fourHour)

    // get positions
    const positions = balance.info.positions
    var hadPosition = false
    for (let i = 0; i < positions.length; i++) {
        const position = positions[i]
        // skip if current position is very small
        if (position.symbol == market.id && position.initialMargin > 5) {
            let unrealizedProfit = position.unrealizedProfit
            let positionSide = position.positionSide
            // calc take profit price and slot loss price based in settings
            let takeProfitPrice = positionSide == POSITION_SIDE.LONG ? position.entryPrice * (1 + PROFIT_PRICE / 100) : position.entryPrice * (1 - PROFIT_PRICE / 100)
            let slotLossPrice = positionSide == POSITION_SIDE.LONG ? position.entryPrice * (1 - STOP_LOSS / 100) : position.entryPrice * (1 + STOP_LOSS / 100)
            // condition to trigger take profit or stop loss action
            let takeProfit = result1M.lastPrice >= takeProfitPrice
            let stopLoss = result1M.lastPrice <= slotLossPrice
            log(`Symbol: ${position.symbol} - Profit: ${unrealizedProfit} - EntryPrice: ${position.entryPrice} - Position Side: ${positionSide} - Isolated: ${position.isolated} - Leverage: ${position.leverage}X`)
            log(`Symbol: ${position.symbol} - TakeProfitPrice: ${takeProfitPrice} - TakeProfit: ${takeProfit} - StopLosstPrice: ${slotLossPrice} - StopLoss: ${stopLoss}`)
            hadPosition = true
            if (takeProfit || stopLoss) {
                await order(position.initialMargin * position.leverage, SIDE.SELL, positionSide)
            }
            break
        }
    }
    if (!hadPosition && ENABLE_TRADE) {
        const direction = result1M.average > result1M.lastPrice ? POSITION_SIDE.SHORT : POSITION_SIDE.LONG
        const amount = parseInt(0.95 * totalUSDT * LEVERAGE)
        await order(amount, SIDE.BUY, direction)
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

async function order(amount, side, position_side) {
    try {
        log(`order with ${SYMBOL} ${amount} ${side} ${position_side}`)
        const order = await binanceExchange.createOrder(SYMBOL, 'market', side, amount, undefined, { 'positionSide': position_side })
        log(order)
    } catch (error) {
        if (error instanceof ccxt.NetworkError) {
            log(`order failed due to a network error: ${error.message}`)
        } else if (error instanceof ccxt.ExchangeError) {
            log(`order failed due to exchange error: ${error.message}`)
        } else {
            log(`order failed with: ${error.message}`)
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