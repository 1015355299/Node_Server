/* TCP Server */
const tcp = require('net')
/* WebSocket Server */
const {
  sendDataByWebSocket,
  hasWebSocketConnect,
} = require('./webSocketServer')
/* redis */
const Redis = require('../db/redis')

// 导入配置
const { tcpConfig } = require('../config/serverConfig.js')

// tcp连接实例集合
let tcpSockets = {}
// 剩余buffer缓冲
let resBuffer = Buffer.from('')
// 上次发送长度
let preRealLen = 0
// 最大img数据长度误差%
const maxImgErr = 0.05
// start buf
const startBuffer = Buffer.from(Uint8Array.of(255, 216))
// end buf
const endBuffer = Buffer.from(Uint8Array.of(255, 217))
// invalid buf
const invalidBuffer = Buffer.from(Uint8Array.of(0, 0))
// data buf <Buffer 7b 22 63 61 72 5f 73 65 63 72 65 74 22>
const dataBuffer = Buffer.from(
  Uint8Array.of(123, 34, 99, 97, 114, 95, 115, 101, 99, 114, 101, 116, 34)
) // {"car_secret"

// <Buffer 7b 22 74 79 70 65 22 3a>      22 7b 5c 22 74 79 70 65 5c 22 3a
// const typeBuffer = Buffer.from(Uint8Array.of(123, 34, 116, 121, 112, 101, 34)) // {"type"
const typeBuffer = Buffer.from(
  Uint8Array.of(34, 132, 92, 34, 116, 121, 112, 101, 92, 34, 58)
) // {"type"
// console.log(typeBuffer.toString());

// 清除连接
function clearConnect(secret) {
  for (const key in tcpSockets) {
    if (key === secret) {
      delete tcpSockets[key]
    }
  }
}

// 创建 tcp 服务器
let tcpServer = tcp.createServer()

// tcp 服务器绑定端口，并开始监听
tcpServer.listen(tcpConfig.port, tcpConfig.host)

// tcp 服务器开始监听触发
tcpServer.on('listening', () => {
  const { address, port } = tcpServer.address()
  console.log(`[主进程]：启动【TCP】服务器 监听 ${address}:${port}`)
})

// 收到连接，进行分发个进程
tcpServer.on('connection', (socket) => {
  const { address, port } = socket.address()
  console.log(`[主进程]：建立新的 TCP 连接，远程客户端地址 ${address}:${port}`)
  // // 保持连接实例
  // tcpSockets = socket
  // return dispatchConnection(socket, `${rinfo.address}:${rinfo.port}`, 'TCP')

  // 设置连接超时时间
  socket.setTimeout(tcpConfig.timeout)

  // 连接超时
  socket.on('timeout', () => {
    console.log(`[主进程]：远程客户端 ${address}:${port} [连接超时准备关闭]`)
    socket.end()
    socket.destroy()
  })

  // tcp 服务器绑定端口，并开始监听
  socket.on('data', (msg) => {
    // console.log(`[主进程]：收到远程客户端 ${rinfo.address}:${rinfo.port} 消息`)
    // 类型数据
    // console.log(msg.toString(),msg.indexOf(typeBuffer),msg)
    if (msg.indexOf(typeBuffer) === 0) {
      // console.log(msg.toString())
      let str = msg.toString()
      const end = str.indexOf('}')
      if (end === -1) return
      str = str.slice(0, end + 1)
      // console.log(msg.toString())
    } else if (msg.indexOf(dataBuffer) === 0) {
      // 串口5发送到服务器数据，用于注册设备
      let str = msg.toString()
      const end = str.indexOf('}')
      if (end === -1) return
      str = str.slice(0, end + 1)
      console.log(str)
      const car_data = JSON.parse(str)
      // 记录设备密钥关联连接
      socket.secret = car_data.car_secret
      tcpSockets[socket.secret] = socket
      // 登记设备
      Redis.registerDevice(car_data.car_secret)
      const data = { type: 'connect', data: { controlIsConnected: true } }
      // 推送数据到前端
      sendDataByWebSocket(socket.secret, JSON.stringify(data))
    } else {
      // 未检测到有客户端连接，则无需处理转发图像数据
      if (!tcpSockets[socket.secret]) return
      // 处理jpg数据流，还原成帧图像流
      handleImgData(socket.secret, msg)
    }
    //console.log('send img')
  })
  // 连接出错
  socket.on('error', () => {
    console.log(
      `[主进程]：远程客户端 ${address}:${port} [客户端错误准备关闭连接]`
    )
    // 销毁连接
    socket.destroy()
  })
  // 连接结束
  socket.on('end', () => {
    console.log(
      `[主进程]：远程客户端 ${address}:${port} [远程客户端主动请求关闭连接]`
    )
  })
  // 连接关闭
  socket.on('close', (err) => {
    clearConnect(socket.secret)
    if (err) {
      console.log(
        `[主进程]：远程客户端 ${address}:${port} [发生传输错误关闭连接]`
      )
    } else {
      console.log(`[主进程]：远程客户端 ${address}:${port} [关闭连接]`)
    }
  })
})

// tcp 服务器出错
tcpServer.on('error', () => {
  console.log(`[主进程]：【TCP】服务器 出错`)
})

// tcp 服务器关闭
tcpServer.on('close', () => {
  console.log(`[主进程]：【TCP】服务器 关闭`)

  // 2s后重启tcp服务器
  setTimeout(() => {
    tcpServer = tcp.createServer()
    // tcp 服务器绑定端口，并开始监听
    tcpServer.listen(tcpConfig.port, tcpConfig.host)
    console.log(`[主进程]：重启【TCP】服务器`)
  }, tcpConfig.restartTimeout)
})

function checkImgValid(data){
  const curLen = data.length
  const curErr = Math.abs(curLen-preRealLen)

  // 更新发送长度
  preRealLen = curLen
  // 误差过大
  if(curErr>preRealLen*maxImgErr){
    return false
  }
  return true
}

// 发送拦截
function send(secret, msg) {
  // console.log(`------------------------------------------------------------------------------------
  // -----------------\r\n${msg.toString('hex')}\r\n`);

  // 校验img
  if (checkImgValid(msg)) {
    // 特权方法发送数据
    sendDataByWebSocket(secret, msg)
  }
}

// 处理图像函数
function handleImgData(secret, msg) {
  let startPos = msg.indexOf(startBuffer)
  let endPos = msg.lastIndexOf(endBuffer)

  // 1. 都没有标记
  if (startPos === -1 && endPos === -1) {
    // 判断是否以00开头和结尾，如果是，则抛弃数据,不是则判断是否存在缓存数据
    let tmpStartPos = msg.indexOf(invalidBuffer)
    let tmpEndPos = msg.lastIndexOf(invalidBuffer)
    if (tmpStartPos === 0 && tmpEndPos === msg.length - 1) {
      // 抛弃本次数据，并清空缓存数据,结束
      return (resBuffer = Buffer.from(''))
    } else if (resBuffer.length) {
      // 存在缓存数据，追加整条数据，如果不存在，则都跳过
      resBuffer = Buffer.concat([resBuffer, msg], resBuffer.length + msg.length)
    }
    return
  }

  // 2.都存在标记
  if (startPos !== -1 && endPos !== -1) {
    // 1.判断结束标记是否在开始标记之前，如果是则判断是否有缓存数据
    if (endPos < startPos) {
      // 结束标记位于开始标记之前，则判断缓存
      if (resBuffer.length) {
        // 存在缓存，则拼接缓存，发送新帧
        const res = msg.slice(0, endPos + 4)
        send(
          secret,
          Buffer.concat([resBuffer, res], resBuffer.length + res.length)
        )
        // 清除缓存，再更新结束标记位置
        resBuffer = Buffer.from('')
      }
      // 不存在缓存则，直接抛弃结束标记，再更新结束标记位置
      endPos = msg.indexOf(endBuffer, startPos + 4)
    }
    // 缓存已空
    // 2.此时，开始标记有效，结束标记还需判断有效性
    if (endPos !== -1) {
      // 结束标记依然有效，则，找到结束标记前最近的开始标记
      let preStartPos = startPos
      while (startPos !== -1 && startPos < endPos) {
        preStartPos = startPos
        startPos = msg.indexOf(startBuffer, startPos + 4)
      }
      // 没找到或者在结束标记之后，都不属于本帧.重新赋值开始标记有效位置
      startPos = preStartPos
      // 此时都有效，并且是最佳帧

      // 发送有效帧
      send(secret, msg.slice(startPos, endPos + 4))
      // 之后，开始和结束标记都未知，所以要从头开始判断有效性，可用尾递归进行
      return handleImgData(secret, msg.slice(endPos + 4))
    } else {
      // 结束标记无效，开始标记有效，则找到最尾的开始标记，并保存缓存
      startPos = msg.lastIndexOf(startBuffer, startPos)
      // 保存进缓存，之后返回
      resBuffer = msg.slice(startPos)
      return
    }
  }

  // 3.只存在一个标记
  // 只存在开始标记,则找到最后一个开始标记，并保存进缓存
  if (startPos !== -1) {
    // 结束标记无效，开始标记有效，则找到最尾的开始标记，并保存缓存
    startPos = msg.lastIndexOf(startBuffer, startPos)
    // 替换，不需要管上次是否有缓存，之后返回
    resBuffer = msg.slice(startPos)
    return
  }
  // 只存在结束标记,判断是否有缓存，如果有，则拼接并返回前端再清空缓存，没有则跳过
  if (endPos !== -1) {
    if (resBuffer.length) {
      const res = msg.slice(0, endPos + 4)
      // 存在缓存，拼接
      send(
        secret,
        Buffer.concat([resBuffer, res], resBuffer.length + res.length)
      )
      // 清空缓存
      resBuffer = Buffer.from('')
      return
    }
  }
  // 结束
}

// 通过tcp发送数据给设备
function sendDataByTCP(secret, data, body) {
  // console.log(Object.keys(tcpSockets));
  if (hasTCPConnect() && tcpSockets[secret]) {
    // 节流中
    if (tcpSockets[secret].isDebounce) return false
    // 发送指令
    console.log(data)
    tcpSockets[secret].write(data)
    // 发送指令节流
    if (body && body.debounce) {
      tcpSockets[secret].isDebounce = true
      setTimeout(() => {
        if (tcpSockets[secret]) {
          tcpSockets[secret].isDebounce = false
        }
      }, body.time)
    }
  }
  return true
}

// 检测是否有tcp连接
function hasTCPConnect() {
  return Object.keys(tcpSockets).length
}

module.exports = {
  tcpServer,
  sendDataByTCP,
  hasTCPConnect,
}
