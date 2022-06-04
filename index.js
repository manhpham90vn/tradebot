const ccxt = require('ccxt')
const moment = require('moment')
const delay = require('delay')
const dotenv = require('dotenv')

// config env
dotenv.config()

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

const PROFIT_PRICE = 0.5
const STOP_LOSS = -0.2
var lastAmount = null
var lastDirection = null

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
    const market = await binanceExchange.market(SYMBOL)
    const setLeverage = await binanceExchange.fapiPrivatePostLeverage({
        'symbol': market.id,
        'leverage': LEVERAGE,
    })
    try {
        const setMarginType = await binanceExchange.fapiPrivatePostMarginType({
            'symbol': market.id,
            'marginType': MARGINTYPE.isolated
        })
    } catch (error) {
        if (error instanceof ccxt.NetworkError) {
            console.log(binanceExchange.id, 'setMarginType failed due to a network error:', error.message)
        } else if (error instanceof ccxt.ExchangeError) {
            console.log(binanceExchange.id, 'setMarginType failed due to exchange error:', error.message)
        } else {
            console.log(binanceExchange.id, 'setMarginType failed with:', error.message)
        }
    }

    // get total usdt
    const balance = await binanceExchange.fetchBalance();
    const totalUSDT = balance.total.USDT
    console.log(`Date: ${Date()}`)
    console.log(`Total USDT: ${totalUSDT}`)

    // analytics
    const result1M = await analytics(SYMBOL, TIME.oneMinute, COUNT_DATA.oneMinute)
    const result1H = await analytics(SYMBOL, TIME.oneHour, COUNT_DATA.oneHour)
    const result4H = await analytics(SYMBOL, TIME.fourHour, COUNT_DATA.fourHour)

    // get positions
    const positions = balance.info.positions
    const amount = parseInt(0.95 * totalUSDT * LEVERAGE)
    var hadPosition = false
    for (let i = 0; i < positions.length; i++) {
        const position = positions[i]
        if (position.positionAmt != 0) {
            let unrealizedProfit = position.unrealizedProfit
            let takeProfit = unrealizedProfit >= PROFIT_PRICE
            let stopLoss = unrealizedProfit <= STOP_LOSS
            console.log(`Symbol: ${position.symbol} Profit: ${unrealizedProfit} EntryPrice: ${position.entryPrice} Isolated: ${position.isolated} Leverage: ${position.leverage}X`)
            console.log(`Symbol: ${position.symbol} takeProfit: ${takeProfit} stopLoss: ${stopLoss}`)
            hadPosition = true
            if (takeProfit || stopLoss) {
                const direction = lastDirection == 'sell' ? 'buy' : 'sell'
                await order(lastAmount, direction)
            }
            break
        }
    }
    if (!hadPosition && ENABLE_TRADE) {
        const direction = result1M.average > result1M.lastPrice ? 'sell' : 'buy'
        lastDirection == direction
        lastAmount = amount
        await order(lastAmount, lastDirection)
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
    console.log(`Time: ${time} Hight: ${hight} Low: ${low} Average: ${average} Current: ${lastPrice}`)
    return { hight: hight, low: low, average: average, lastPrice: lastPrice }
}

async function order(amount, direction) {
    try {
        console.log(`order with ${SYMBOL} ${direction} ${amount}`)
        const order = await binanceExchange.createOrder(SYMBOL, 'market', direction, amount)
        console.log(order)
    } catch (error) {
        if (error instanceof ccxt.NetworkError) {
            console.log(binanceExchange.id, 'order failed due to a network error:', error.message)
        } else if (error instanceof ccxt.ExchangeError) {
            console.log(binanceExchange.id, 'order failed due to exchange error:', error.message)
        } else {
            console.log(binanceExchange.id, 'order failed with:', error.message)
        }
    }
}

async function main() {
    while (true) {
        await getInfo()
        await delay(DELAY)
        console.log(`------------------------------------------------------------`)
    }
}

main()