const util = require('util');
const async = require('async');
const SensorTag = require('sensortag');
const debug = require('debug')('sensortag_report');
const Influx = require('influx');

/*****************************************************
 * Promisification
 * **************************************************/
function stPromisify(func) {
  return (...args) =>
    new Promise((resolve, reject) => {
      const callback = (data) => resolve(data);
      func.apply(this, [...args, callback]);
    })
}

function after(dur){
  return new Promise((resolve, reject) => {
    setTimeout(resolve, dur);
  });
}
/*****************************************************
 * Program parameters
 * **************************************************/
if(process.env.DB){
  var db = process.env.DB;
}
else{
  var db = 'st_report';
}

if(process.env.DB_USER){
  var db_user = process.env.DB_USER;
}
else{
  console.log('ERROR : DB_USER variable must be set');
  process.exit(1);
}

var db_host = "localhost";
if(process.env.DB_HOST){
  db_host = process.env.DB_HOST;
}

if(process.env.DB_PASS){
  var db_pass = process.env.DB_PASS;
}
else{
  console.log('ERROR : DB_PASS variable must be set');
  process.exit(1);
}

/*******************************************************************************
 * Exit handlers
 ******************************************************************************/

process.stdin.resume(); // so the program will not close instantly

function exitHandler(options, err) {
  //only keep uncaught exception listener
  process.removeAllListeners('exit');
  process.removeAllListeners('SIGINT');
  debug('exiting reporter...');
  if (options.cleanup){
    stReport.close()
    .catch((err) => {
      debug(err.stack);
    })
    .then(() => {
      debug('sensortag  reporter closed');
      if (options.exit) process.exit();
    });
  }
  else{
    if (err) debug(err.stack);
    if (options.exit){
      process.exit();
    }
  }
}

//do something when app is closing
process.on('exit', function(){
  debug('exit signal caught');
  exitHandler({cleanup : true}, null);
});

//catches ctrl+c event
process.on('SIGINT', function(){
  debug('SIGINT signal caught');
  exitHandler({cleanup : true, exit : true}, null);
});

//catches uncaught exceptions
process.on('uncaughtException', function(exc){
  debug('uncaught exception : ' + exc);
  exitHandler({exit : true}, exc);
});


/***************************************************************************
 * Sensortag method overload because of modification in sensortag firmware  
 * *************************************************************************/
/** Sensortag firmware modified in order to have period on range 1 -> 255 with a 1s resolution */
SensorTag.CC2650.prototype.writePeriodCharacteristic = function(serviceUuid, characteristicUuid, period, callback) {
  if (period < 1) {
    period = 1;
  } else if (period > 255) {
    period = 255;
  }
  this.writeUInt8Characteristic(serviceUuid, characteristicUuid, period, callback);
};


/***************/
/** CONSTANTS  */
/***************/
/** Max connect/setup duration in ms - After many reconnections, it takes some 10s to connect, TODO : investigate it using packet sniffer*/
const CONNECT_SETUP_MAX_DUR = 40000;
/** After a successful connection, some ms */
const WAIT_AFTER_CONN_DUR    = 1500;
const CONNECT_CONFIG_MAX_DUR = CONNECT_SETUP_MAX_DUR + WAIT_AFTER_CONN_DUR + 2000;


/*****************************************************
 * SensortagReport Class 
 * **************************************************/
class SensortagReport {

  constructor(){
    this._sensorTags = {};

    this._bindings = {};

    this._dbClient = new Influx.InfluxDB({

      //single-host configuration 
      host : db_host,
      port : 8086, // optional, default 8086 
      protocol : 'http', // optional, default 'http' 
      database : db,
      username : db_user,
      password : db_pass
    });
  }

  async init(){
    return this.openDb(db);
  }


  async openDb(dbName){
    const NB_CONNECT_TRIES = 2;
    return this.createDb(dbName)
      .catch(err => {
        this._nbConnectTries++;
        if(this._nbConnectTries >= NB_CONNECT_TRIES){
          throw new Error("could not create db " + dbName + " err - " + err);
        }
        else{
          debug("unable to create db - try " + (NB_CONNECT_TRIES - this._nbConnectTries) + " time(s) again - " + err);
          return after(2000)
            .then(() => {
              return this.openDb(dbName);
            })
        }
      })
  }


  async createDb(dbName){
    debug("create db : " + dbName);
    /** check db connection & existence */
    return this._dbClient.getDatabaseNames()
      .then((dbNames) => {
        debug("got db names");
        if(dbNames.indexOf(dbName) == -1){
          debug("db " + dbName + " does not exist - create it");
          return this._dbClient.createDatabase(dbName)
            .catch(err => {
              debug(err + " when creating db " + dbName);
              throw err;
            })
        }
        else{
          debug("db " + dbName + " exists");
        }
      })
  }

  _setBindings(sensorTag){
    this._sensorTags[sensorTag.uuid]._bindings = {};
    this._sensorTags[sensorTag.uuid]._bindings.onHumidityChanged = this.onHumidityChanged.bind(this, this._sensorTags[sensorTag.uuid]);
    this._sensorTags[sensorTag.uuid]._bindings.onBarometricPressureChanged = this.onBarometricPressureChanged.bind(this, this._sensorTags[sensorTag.uuid]);
    this._sensorTags[sensorTag.uuid]._bindings.onIrTemperatureChanged = this.onIrTemperatureChanged.bind(this, this._sensorTags[sensorTag.uuid]);
    this._sensorTags[sensorTag.uuid]._bindings.onLuxometerChanged = this.onLuxometerChanged.bind(this, this._sensorTags[sensorTag.uuid]);
    this._sensorTags[sensorTag.uuid]._bindings.onAccelerometerChanged = this.onAccelerometerChanged.bind(this, this._sensorTags[sensorTag.uuid]);
    this._sensorTags[sensorTag.uuid]._bindings.onBatteryLevelChanged = this.onBatteryLevelChanged.bind(this, this._sensorTags[sensorTag.uuid]);
    this._sensorTags[sensorTag.uuid]._bindings.onDisconnect = this.onDisconnect.bind(this, this._sensorTags[sensorTag.uuid]);

    this._sensorTags[sensorTag.uuid].on('humidityChange', this._sensorTags[sensorTag.uuid]._bindings.onHumidityChanged);
    this._sensorTags[sensorTag.uuid].on('barometricPressureChange', this._sensorTags[sensorTag.uuid]._bindings.onBarometricPressureChanged);
    this._sensorTags[sensorTag.uuid].on('irTemperatureChange', this._sensorTags[sensorTag.uuid]._bindings.onIrTemperatureChanged);
    this._sensorTags[sensorTag.uuid].on('luxometerChange', this._sensorTags[sensorTag.uuid]._bindings.onLuxometerChanged);
    this._sensorTags[sensorTag.uuid].on('accelerometerChange', this._sensorTags[sensorTag.uuid]._bindings.onAccelerometerChanged);
    this._sensorTags[sensorTag.uuid].on('batteryLevelChange', this._sensorTags[sensorTag.uuid]._bindings.onBatteryLevelChanged);
  }

  async addSensortagReporters(){
    return this.addSensortagReporter()
    .then(() => {
      debug("added reporter - try to add some other sensortag reporters");
      return;
    })
    .catch((err) => {
      debug("err when adding reporters - " + err);
      debug("try to add some other sensortag reporters");
      return;
    })
    .then(() => {
      after(500);
    })
    .then(() => {
      return this.addSensortagReporters();
    });
  }

  async addSensortagReporter(){
    debug('try to discover some reporters');
    return stPromisify(SensorTag.discover)()
      .then((sensorTag) => {
        debug('discovered: ' + sensorTag);
        if(this._sensorTags[sensorTag.uuid] !== undefined){
          throw new Error('tag ' + sensorTag.uuid + ' already handled');
        }
        else{
          this._sensorTags[sensorTag.uuid] = sensorTag;
          this._setBindings(sensorTag);

          /** Timeout to detect failing reporter adding, in some cases, when peripheral disconnects, no disconnect 
           * event is sent. So a timeout is needed during this process */
          var timerId;
          return new Promise((resolve, reject) => {
            timerId = setTimeout(() => {
              /** clear disconnect listeners, if not reporter adding disconnect callback can be called later */   
              this._sensorTags[sensorTag.uuid].removeAllListeners('disconnect');
              if(sensorTag._peripheral.state === 'connected'){                  
                debug('try to disconnect reporter');
                sensorTag.disconnect(() => {
                  debug('reporter disconnected');
                  reject('reporter ' + sensorTag.uuid + ' timeout during preparation for capture', sensorTag);
                });
              }
              else{
                reject('reporter ' + sensorTag.uuid + ' timeout during preparation for capture', sensorTag);
              }
            }, CONNECT_CONFIG_MAX_DUR);

            /** If tag disconnected during adding => exit */
            this._sensorTags[sensorTag.uuid].on('disconnect', () => {
              clearTimeout(timerId);
              this._sensorTags[sensorTag.uuid].removeAllListeners('disconnect');
              reject('tag ' + sensorTag.uuid + ' disconnected during preparation for capture', sensorTag);
            });

            this.startCapture(this._sensorTags[sensorTag.uuid])
            .then(() => {
              clearTimeout(timerId);
              this._sensorTags[sensorTag.uuid].removeAllListeners('disconnect');
              this._sensorTags[sensorTag.uuid].on('disconnect', this._sensorTags[sensorTag.uuid]._bindings.onDisconnect);
              resolve();
            })
          })
          .catch((err) => {
            debug(err + ' when adding reporter with uuid ' + sensorTag .uuid);
            clearTimeout(timerId);
            if(this._sensorTags[sensorTag.uuid])
              delete this._sensorTags[sensorTag.uuid];
            return err; 
          })
        }
      })
  }


  async startCapture(sensorTag){
    return new Promise((resolve, reject) => {
      debug('connectAndSetUp');
      var timerId = setTimeout(() => {
          reject('Timeout on connectAndSetup');
      }, CONNECT_SETUP_MAX_DUR);
      sensorTag.connectAndSetUp(() => {
          clearTimeout(timerId);
          resolve();
      });
    })
    .then(() => {
      debug('Wait ' + WAIT_AFTER_CONN_DUR +  'ms after connection');
      setTimeout(() => {return}, WAIT_AFTER_CONN_DUR);
    })
    .then(() => {
      debug('enable humidity and temperature');
      debug(sensorTag.uuid);
      debug(sensorTag.enableHumidity.toString());
      return stPromisify(sensorTag.enableHumidity.bind(sensorTag))();
    })
    .then(() => {
      debug('set humidity and temperature period');
      return stPromisify(sensorTag.setHumidityPeriod.bind(sensorTag))(30);
    })
    .then(() => {
      debug('notify humidity and temperature');
      return stPromisify(sensorTag.notifyHumidity.bind(sensorTag))();
    })
    .then(() => {
      debug('enable barometric pressure');
      return stPromisify(sensorTag.enableBarometricPressure.bind(sensorTag))();
    })
    .then(() => {
      debug('set barometric pressure period');
      return stPromisify(sensorTag.setBarometricPressurePeriod.bind(sensorTag))(60*15);
    })
    .then(() => {
      debug('notify barometric pressure');
      return stPromisify(sensorTag.notifyBarometricPressure.bind(sensorTag))();
    })
    //.then(() => {
    //  debug('enable ambient temperature');
    //  return stPromisify(sensorTag.enableIrTemperature.bind(sensorTag))();
    //})
    //.then(() => {
    //  debug('set ambient temperature period');
    //  return stPromisify(sensorTag.setIrTemperaturePeriod.bind(sensorTag))(30);
    //})
    //.then(() => {
    //  debug('notify ambient temperature');
    //  return stPromisify(sensorTag.notifyIrTemperature.bind(sensorTag))();
    //})
    .then(() => {
      debug('enable luxometer');
      return stPromisify(sensorTag.enableLuxometer.bind(sensorTag))();
    })
    .then(() => {
      debug('set luxometer period');
      return stPromisify(sensorTag.setLuxometerPeriod.bind(sensorTag))(10);
    })
    .then(() => {
      debug('notify luxometer');
      return stPromisify(sensorTag.notifyLuxometer.bind(sensorTag))();
    })
    //.then(() => {
    //  debug('enable wom');
    //  return stPromisify(sensorTag.enableWOM.bind(sensorTag))();
    //})
    //.then(() => {
    //  debug('enable accelerometer');
    //  return stPromisify(sensorTag.enableAccelerometer.bind(sensorTag))();
    //})
    //.then(() => {
    //  debug('set accelerometer period');
    //  return stPromisify(sensorTag.setAccelerometerPeriod.bind(sensorTag))(2);
    //})
    .then(() => {
      debug('notify accelerometer');
      return stPromisify(sensorTag.notifyAccelerometer.bind(sensorTag))();
    })
    .then(() => {
      debug('read battery level');
      return stPromisify(sensorTag.readBatteryLevel.bind(sensorTag))()
    })
    .then((level) => {
      this.onBatteryLevelChanged(sensorTag, level);
      debug('notify battery level');
      return stPromisify(sensorTag.notifyBatteryLevel.bind(sensorTag))();
    })
    .catch((err) => {
      this._sensorTags[sensorTag.uuid].removeAllListeners('disconnect');
      debug(err + ' during start capture');
      if(sensorTag._peripheral.state === 'connected'){                  
        debug('try to disconnect reporter');
        return stPromisify(sensorTag.disconnect.bind(sensorTag))()
        .then(() => {
          debug("reporter disconnected");
          return;
        })
        .catch((err) => {
          debug("could not disconnect reporter");
          return;
        })
        .then(() => {
          throw new Error(err + ' cannot start capture ' + err.stack);
        });
      }
      else
      {
        throw (new Error(err + ' cannot start capture' + err.stack));
      }
    })
  }


  onHumidityChanged(sensorTag, temperature, humidity) {
    debug('\treporter %s - temperature = %d °C', sensorTag.uuid, temperature.toFixed(1));
    debug('\treporter %s - humidity = %d %', sensorTag.uuid, humidity.toFixed(1));
    this.toDb(sensorTag, "temperature", temperature);
    this.toDb(sensorTag, "humidity", humidity);
  }

  onBarometricPressureChanged(sensorTag, pressure) {
    debug('\treporter %s - pressure = %d mBar', sensorTag.uuid, pressure.toFixed(1));
    this.toDb(sensorTag, "pressure", pressure);
  }

  onIrTemperatureChanged(sensorTag, objectTemperature, ambientTemperature) {
    debug('\treporter %s - object temperature = %d °C', sensorTag.uuid, objectTemperature.toFixed(1));
    debug('\treporter %s - ambient temperature = %d °C', sensorTag.uuid, ambientTemperature.toFixed(1));
    this.toDb(sensorTag, "ambient_temperature", ambientTemperature);
  }

  onLuxometerChanged(sensorTag, lux) {
    debug('\treporter %s - LUX = %d lux', sensorTag.uuid, lux.toFixed(1));
    this.toDb(sensorTag, "lux", lux);
  }

  onAccelerometerChanged(sensorTag, x, y, z) {
    debug('\treporter %s - ACCEL  (%d, %d, %d)G', sensorTag.uuid, x, y, z);
    this.toDb(sensorTag, "accelX", x);
    this.toDb(sensorTag, "accelY", y);
    this.toDb(sensorTag, "accelZ", z);
  }

  onBatteryLevelChanged(sensorTag, level) {
    debug('\treporter %s - Battery level  %d%', sensorTag.uuid, level);
    this.toDb(sensorTag, "battery", level);
  }

  toDb(sensorTag, fieldName, fieldValue)
  {
    this._dbClient.writeMeasurement(fieldName+ '_TI_ST_' + sensorTag.uuid, [
      {
        fields : {
          value: fieldValue
        }
      }
    ])
      .catch(err => {
        debug("Cannot write to db : " + err);
      })
  }


  onDisconnect(sensorTag){
    debug('reporter ' + sensorTag.uuid + ' disconnected');
    if(this._sensorTags[sensorTag.uuid])
      delete this._sensorTags[sensorTag.uuid];
  }

  async close(){
    var promises = [];
    return new Promise((resolve, reject) => { 
      for(uuid in this.sensorTags){
        if(this._sensorTags[uuid]._peripheral.state === 'connected'){
          promises.push(stPromisify(this._sensorTags[uuid].disconnect)());
        }
      }
      Promise.all(promises)
      .catch((err) => {
        debug("could not disconnect sensortag '" + uuid + "' " + err);
        reject()
      })
      .then(() => {
        resolve();
      })
    });
  }
}

/*****************************************************
 * Sensortag report scenario 
 * **************************************************/
debug("starting sensortag report");

var stReport = new SensortagReport();
stReport.init()
.then(() => {
  return stReport.addSensortagReporters();
})
.catch((err) => {
  debug("should never be here" + err.stack);
  exitHandler({cleanup : true, exit : true}, null);
});
