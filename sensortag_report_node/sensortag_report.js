var util = require('util');
var async = require('async');
var SensorTag = require('sensortag');
var debug = require('debug')('sensortag_report');
var influx = require('influx');

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

function IndoorReport(callback)
{
  this._sensorTags = {};
  
  this._bindings = {};
  this._bindings.onSensorTagReporterAdded = this.onSensorTagReporterAdded.bind(this);
  
  this._dbClient = influx({
  
    //single-host configuration 
    host : 'localhost',
    port : 8086, // optional, default 8086 
    protocol : 'http', // optional, default 'http' 
    database : db,
    username : db_user,
    password : db_pass
  });
}

IndoorReport.prototype.init = function(callback)
{
  var nbConnectTries = 10;
  
  /** check db connection & existence */
  this._dbClient.getDatabaseNames(function(err, dbNames)
  {
    if(err)
    {
      debug(err + ' unable to get db names - try ' + nbConnectTries + ' times');
      var timer = setInterval(function(){
        this._dbClient.getDatabaseNames(function(err, dbNames){
          nbConnectTries--;
          if(!err)
          {
            clearInterval(timer);
            this.createDb(dbNames, callback);
          }
          
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
        }.bind(this));
      }.bind(this), 2000);
    }
    else
    {
      this.createDb(dbNames, callback);
    }
  }.bind(this));
};

IndoorReport.prototype.createDb = function(dbNames, callback)
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

IndoorReport.prototype.addSensortagReporter = function(callback)
{
  SensorTag.discover(function(sensorTag) {
    debug('discovered: ' + sensorTag);
    
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
    this._sensorTags[sensorTag.uuid].on('disconnect', this._sensorTags[sensorTag.uuid]._bindings.onDisconnect);
      
    this.startCapture(this._sensorTags[sensorTag.uuid], callback);
  }.bind(this));
};

IndoorReport.prototype.startCapture = function(sensorTag, callback)
{
  //console.log(sensorTag, fn_callback);
  async.series([
               function(callback_series) {
                debug('connectAndSetUp');
                sensorTag.connectAndSetUp(callback_series);
              },
              function(callback_series) {
                debug('enable humidity and temperature');
                sensorTag.enableHumidity(callback_series);
              },
              function(callback_series) {
                debug('set humidity and temperature period');
                sensorTag.setHumidityPeriod(10000, callback_series);
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
                sensorTag.setBarometricPressurePeriod(30000, callback_series);
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
                sensorTag.setIrTemperaturePeriod(10000, callback_series);
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
                sensorTag.setLuxometerPeriod(10000, callback_series);
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
                sensorTag.setAccelerometerPeriod(200, callback_series);
              },
              function(callback_series) {
                debug('notify luxometer');
                sensorTag.notifyAccelerometer(callback_series);
              },
              function(callback_series) {
                debug('notify battery level');
                sensorTag.notifyBatteryLevel(callback_series);
              }.bind(this),
            ],
            function(err, results){
                if(err)
                {
                  debug(err + ' during start capture - disconnect sensortag');
                  sensorTag.disconnect(function(){
                    //remove sensortag from object
                    this._sensorTag = null;
                    debug('sensortag disconnected');
                    callback(new Error(err + ' cannot start capture'), sensorTag);
                  });
                }
                else
                {
                  callback(null, sensorTag);
                }
              });
};

IndoorReport.prototype.onHumidityChanged = function(sensorTag, temperature, humidity) {
  debug('\treporter %s - temperature = %d °C', sensorTag.uuid, temperature.toFixed(1));
  debug('\treporter %s - humidity = %d %', sensorTag.uuid, humidity.toFixed(1));
  this.toDb(sensorTag, "temperature", temperature);
  this.toDb(sensorTag, "humidity", humidity);
};

IndoorReport.prototype.onBarometricPressureChanged = function(sensorTag, pressure) {
  debug('\treporter %s - pressure = %d mBar', sensorTag.uuid, pressure.toFixed(1));
  this.toDb(sensorTag, "pressure", pressure);
};

IndoorReport.prototype.onIrTemperatureChanged = function(sensorTag, objectTemperature, ambientTemperature) {
  debug('\treporter %s - object temperature = %d °C', sensorTag.uuid, objectTemperature.toFixed(1));
  debug('\treporter %s - ambient temperature = %d °C', sensorTag.uuid, ambientTemperature.toFixed(1))
  this.toDb(sensorTag, "ambient_temperature", ambientTemperature);
};

IndoorReport.prototype.onLuxometerChanged = function(sensorTag, lux) {
  debug('\treporter %s - LUX = %d lux', sensorTag.uuid, lux.toFixed(1));
  this.toDb(sensorTag, "lux", lux);
};

IndoorReport.prototype.onAccelerometerChanged = function(sensorTag, x, y, z) {
  debug('\treporter %s - ACCEL  (%d, %d, %d)G', sensorTag.uuid, x, y, z);
  this.toDb(sensorTag, "accelX", x);
  this.toDb(sensorTag, "accelY", y);
  this.toDb(sensorTag, "accelZ", z);
};

IndoorReport.prototype.onBatteryLevelChanged = function(sensorTag, level) {
  debug('\treporter %s - Battery level  %d%', sensorTag.uuid, level);
  this.toDb(sensorTag, "battery", level);
};

IndoorReport.prototype.toDb = function(sensorTag, fieldName, fieldValue)
{
  this._dbClient.writePoint(fieldName+ '_TI_ST_' + sensorTag.uuid, {time: new Date(), value: fieldValue}, null, function(err, response) { 
    if(err)
      {
        debug("Cannot write to db : " + err);
      }});
};

IndoorReport.prototype.onSensorTagReporterAdded = function(err, sensorTag)
{
  if(err)
  {
    debug(err + ' when adding reporter with uuid ' + sensorTag .uuid);
    if(this._sensorTags[sensorTag.uuid])
      delete this._sensorTags[sensorTag.uuid];
  }
  debug('try to discover other reporters');
  indoorReport.addSensortagReporter(this._bindings.onSensorTagReporterAdded);
};

IndoorReport.prototype.onDisconnect = function(sensorTag)
{
  debug('sensortag disconnected');
};



debug("starting sensortag indoor report");
  
var indoorReport = new IndoorReport();
indoorReport.init(function(err){
  if(err)
  {
    debug('Unable to init - exit');
    process.exit(2);
  }
  debug('indoor reported initialized');
  indoorReport.addSensortagReporter(indoorReport._bindings.onSensorTagReporterAdded);
});
