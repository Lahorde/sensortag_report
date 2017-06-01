var util = require('util');
var async = require('async');
var SensorTag = require('sensortag');
var debug = require('debug')('sensortag_report');
var Influx = require('influx');

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
    stReport.close(function(err){
      debug('sensortag  reporter closed');
      if (err) debug(err.stack);
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


/*****************************************************
 * SensortagReport Class 
 * **************************************************/
function SensortagReport(callback)
{
  this._sensorTags = {};

  this._bindings = {};
  this._bindings.onSensorTagReporterAdded = this.onSensorTagReporterAdded.bind(this);

  this._dbClient = new Influx.InfluxDB({

    //single-host configuration 
    host : 'rpi-home-master.local',
    port : 8086, // optional, default 8086 
    protocol : 'http', // optional, default 'http' 
    database : db,
    username : db_user,
    password : db_pass
  });
}

/***************/
/** CONSTANTS  */
/***************/
/** Max connect/setup duration in ms - After many reconnections, it takes some 10s to connect, TODO : investigate it using packet sniffer*/
SensortagReport.CONNECT_SETUP_MAX_DUR = 30000;
/** After a successful connection, some ms */
SensortagReport.WAIT_AFTER_CONN_DUR    = 1500;
SensortagReport.CONNECT_CONFIG_MAX_DUR = SensortagReport.CONNECT_SETUP_MAX_DUR + SensortagReport.WAIT_AFTER_CONN_DUR + 2000;


SensortagReport.prototype.init = function(callback)
{
  var nbConnectTries = 10;

  debug("create db");
  /** check db connection & existence */
  this._dbClient.getDatabaseNames()
    .then(dbNames => {
      this.createDb(dbNames, callback);
    })
    .catch(err => {
      debug(err + ' unable to get db names - try ' + nbConnectTries + ' times');
      var timer = setInterval(function(){
        this._dbClient.getDatabaseNames()
          .then(dbNames => {
            clearInterval(timer);
            this.createDb(dbNames, callback);
          })
          .catch(err => {
            nbConnectTries--;
            if(nbConnectTries === 0)
            {  
              clearInterval(timer);
              debug(err + ' - could not connect to db');
              callback(new Error(err + ' - could not check db connection or db existence'));
            }
            else
            {
              debug(err + ' unable to get db names - try ' + nbConnectTries + ' times');
            }
          })
      }.bind(this), 2000);
    })
};

SensortagReport.prototype.createDb = function(dbNames, callback)
{
  if(dbNames.indexOf(db) == -1)
  {
    this._dbClient.createDatabase(db, function(err, result) {
      if(err)
      {
        debug(err + ' when creating db ' + db);
      }
      callback(err); 
    });
  }
  else
  {
    callback();
  }
};

SensortagReport.prototype.addSensortagReporter = function(callback)
{
  SensorTag.discover(function(sensorTag) {
    debug('discovered: ' + sensorTag);
    if(this._sensorTags[sensorTag.uuid] !== undefined)
    {
      return callback('tag ' + sensorTag.uuid + ' already handled');
    }
    else
    {
    }

    this._sensorTags[sensorTag.uuid] = sensorTag;

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

    /** Timeout to detect failing reporter adding, in some cases, when peripheral disconnects, no disconnect 
     * event is sent. So a timeout is needed during this process */
    var timerId = setTimeout(function()
      {
        /** clear disconnect listeners, if not reporter adding disconnect callback can be called later */   
        this._sensorTags[sensorTag.uuid].removeAllListeners('disconnect');
        if(sensorTag._peripheral.state === 'connected'){                  
          debug('try to disconnect reporter');
          sensorTag.disconnect(function(){
            debug('reporter disconnected');
            callback('reporter ' + sensorTag.uuid + ' timeout during preparation for capture', sensorTag);
          });
        }
        else
        {
          callback('reporter ' + sensorTag.uuid + ' timeout during preparation for capture', sensorTag);
        }
      }.bind(this), SensortagReport.CONNECT_CONFIG_MAX_DUR);

    /** If tag disconnected during adding => exit */
    this._sensorTags[sensorTag.uuid].on('disconnect', function(){
      clearTimeout(timerId);
      this._sensorTags[sensorTag.uuid].removeAllListeners('disconnect');
      callback('tag ' + sensorTag.uuid + ' disconnected during preparation for capture', sensorTag);
    }.bind(this));

    this.startCapture(this._sensorTags[sensorTag.uuid], function(err){
      clearTimeout(timerId);
      this._sensorTags[sensorTag.uuid].on('disconnect', this._sensorTags[sensorTag.uuid]._bindings.onDisconnect);
      callback(err, sensorTag);
    }.bind(this));
  }.bind(this));
};

SensortagReport.prototype.startCapture = function(sensorTag, callback)
{
  async.series([
    function(callback_series) {
      debug('connectAndSetUp');
      timerElapsed = false;
      timerId = setTimeout(function()
        {
          callback_series('Timeout on connectAndSetup');
        }, SensortagReport.CONNECT_SETUP_MAX_DUR);
      sensorTag.connectAndSetUp(function()
        {
          clearTimeout(timerId);
          callback_series();
        });
    },
    function(callback_series) {
      debug('Wait ' + SensortagReport.WAIT_AFTER_CONN_DUR +  'ms after connection');
      setTimeout(callback_series, SensortagReport.WAIT_AFTER_CONN_DUR);
    },
    function(callback_series) {
      debug('enable humidity and temperature');
      sensorTag.enableHumidity(callback_series);
    },
    function(callback_series) {
      debug('set humidity and temperature period');
      //5s period
      sensorTag.setHumidityPeriod(5, callback_series);
    },              
    function(callback_series) {
      debug('notify humidity and temperature');
      sensorTag.notifyHumidity(callback_series);
    },
    function(callback_series) {
      debug('enable barometric pressure');
      sensorTag.enableBarometricPressure(callback_series);
    },
    function(callback_series) {
      debug('set barometric pressure period');
      sensorTag.setBarometricPressurePeriod(30, callback_series);
    },
    function(callback_series) {
      debug('notify barometric pressure');
      sensorTag.notifyBarometricPressure(callback_series);
    },
    function(callback_series) {
      debug('enable ambient temperature');
      sensorTag.enableIrTemperature(callback_series);
    },
    function(callback_series) {
      debug('set ambient temperature period');
      sensorTag.setIrTemperaturePeriod(5, callback_series);
    },
    function(callback_series) {
      debug('notify ambient temperature');
      sensorTag.notifyIrTemperature(callback_series);
    },
    function(callback_series) {
      debug('enable luxometer');
      sensorTag.enableLuxometer(callback_series);
    },
    function(callback_series) {
      debug('set luxometer period');
      sensorTag.setLuxometerPeriod(5, callback_series);
    },
    function(callback_series) {
      debug('notify luxometer');
      sensorTag.notifyLuxometer(callback_series);
    },
    function(callback_series) {
      debug('enable wom');
      sensorTag.enableWOM(callback_series);
    },
    function(callback_series) {
      debug('enable accelerometer');
      sensorTag.enableAccelerometer(callback_series);
    },
    function(callback_series) {
      debug('set accelerometer period');
      sensorTag.setAccelerometerPeriod(2, callback_series);
    },
    function(callback_series) {
      debug('notify luxometer');
      sensorTag.notifyAccelerometer(callback_series);
    },
    function(callback_series) {
      debug('read battery level');
      sensorTag.readBatteryLevel(function(err, level){
        if(!err)
          this.onBatteryLevelChanged(sensorTag, level);
        callback_series(err);
      }.bind(this));
    }.bind(this),
    function(callback_series) {
      debug('notify battery level');
      sensorTag.notifyBatteryLevel(callback_series);
    }.bind(this),
  ],
    function(err, results){
      this._sensorTags[sensorTag.uuid].removeAllListeners('disconnect');
      if(err)
      {
        debug(err + ' during start capture');
        if(sensorTag._peripheral.state === 'connected'){                  
          debug('try to disconnect reporter');
          sensorTag.disconnect(function(){
            debug('reporter disconnected');
            callback(new Error(err + ' cannot start capture'), sensorTag);
          });
        }
        else
        {
          callback(new Error(err + ' cannot start capture'), sensorTag);
        }
      }
      else
      {
        callback(null, sensorTag);
      }
    }.bind(this));
};

SensortagReport.prototype.onHumidityChanged = function(sensorTag, temperature, humidity) {
  debug('\treporter %s - temperature = %d °C', sensorTag.uuid, temperature.toFixed(1));
  debug('\treporter %s - humidity = %d %', sensorTag.uuid, humidity.toFixed(1));
  this.toDb(sensorTag, "temperature", temperature);
  this.toDb(sensorTag, "humidity", humidity);
};

SensortagReport.prototype.onBarometricPressureChanged = function(sensorTag, pressure) {
  debug('\treporter %s - pressure = %d mBar', sensorTag.uuid, pressure.toFixed(1));
  this.toDb(sensorTag, "pressure", pressure);
};

SensortagReport.prototype.onIrTemperatureChanged = function(sensorTag, objectTemperature, ambientTemperature) {
  debug('\treporter %s - object temperature = %d °C', sensorTag.uuid, objectTemperature.toFixed(1));
  debug('\treporter %s - ambient temperature = %d °C', sensorTag.uuid, ambientTemperature.toFixed(1));
  this.toDb(sensorTag, "ambient_temperature", ambientTemperature);
};

SensortagReport.prototype.onLuxometerChanged = function(sensorTag, lux) {
  debug('\treporter %s - LUX = %d lux', sensorTag.uuid, lux.toFixed(1));
  this.toDb(sensorTag, "lux", lux);
};

SensortagReport.prototype.onAccelerometerChanged = function(sensorTag, x, y, z) {
  debug('\treporter %s - ACCEL  (%d, %d, %d)G', sensorTag.uuid, x, y, z);
  this.toDb(sensorTag, "accelX", x);
  this.toDb(sensorTag, "accelY", y);
  this.toDb(sensorTag, "accelZ", z);
};

SensortagReport.prototype.onBatteryLevelChanged = function(sensorTag, level) {
  debug('\treporter %s - Battery level  %d%', sensorTag.uuid, level);
  this.toDb(sensorTag, "battery", level);
};

SensortagReport.prototype.toDb = function(sensorTag, fieldName, fieldValue)
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
};

SensortagReport.prototype.onSensorTagReporterAdded = function(err, sensorTag)
{
  if(sensorTag)
  {
    if(err)
    {
      debug(err + ' when adding reporter with uuid ' + sensorTag .uuid);
      if(this._sensorTags[sensorTag.uuid])
        delete this._sensorTags[sensorTag.uuid];
    }
  }
  else
  {
    /** No sensortag added */
    debug(err + ' when adding a reporter');
  }
  debug('try to discover other reporters');
  setTimeout(function(){
    stReport.addSensortagReporter(this._bindings.onSensorTagReporterAdded);
  }.bind(this), 500);
};

SensortagReport.prototype.onDisconnect = function(sensorTag)
{
  debug('reporter ' + sensorTag.uuid + ' disconnected');
  if(this._sensorTags[sensorTag.uuid])
    delete this._sensorTags[sensorTag.uuid];
};

SensortagReport.prototype.close = function(callback){
  async.forEach(Object.keys(this._sensorTags), function(uuid, callbackForEach){
    if(this._sensorTags[uuid]._peripheral.state === 'connected'){
      this._sensorTags[uuid].disconnect(callbackForEach);
    }
    else{
      callbackForEach();
    }
  }.bind(this), function(err){
    this._sensorTags = [];
    if(err){
      debug('some reporter have not been disconnected');
    }
    else{
      debug('all reporters have been disconnected');
    }
    callback(err);
  }.bind(this));
};

/*****************************************************
 * Sensortag report scenario 
 * **************************************************/
debug("starting sensortag report");

var stReport = new SensortagReport();
stReport.init(function(err){
  if(err)
  {
    debug('Unable to init - exit');
    process.exit(2);
  }
  debug('sensortag reported initialized');
  stReport.addSensortagReporter(stReport._bindings.onSensorTagReporterAdded);
});
