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
  this._sensorTag = null;
  this._dbClient = influx({
   
    //single-host configuration 
    host : 'localhost',
    port : 8086, // optional, default 8086 
    protocol : 'http', // optional, default 'http' 
    database : db,
    username : db_user,
    password : db_pass
  });
  this._dbClient.createDatabase(db, function(err, result) {
    if(err)
    {
      debug(err + ' when creating db ' + db);
    }
     callback(err); 
  } );  
}

IndoorReport.prototype.connectSensortag = function(callback)
{
  SensorTag.discover(function(sensorTag) {
    debug('discovered: ' + sensorTag);
    this._sensorTag = sensorTag;
    
    this._sensorTag.on('humidityChange', this.onHumidityChanged.bind(this, this._sensorTag));
    this._sensorTag.on('barometricPressureChange', this.onBarometricPressureChanged.bind(this, this._sensorTag));
    this._sensorTag.on('irTemperatureChange', this.onIrTemperatureChanged.bind(this, this._sensorTag));
    this._sensorTag.on('luxometerChange', this.onLuxometerChanged.bind(this, this._sensorTag));
    this._sensorTag.on('accelerometerChange', this.onAccelerometerChanged.bind(this, this._sensorTag));
    this._sensorTag.on('batteryLevelChange', this.onBatteryLevelChanged.bind(this, this._sensorTag));
    this._sensorTag.on('disconnect', this.onDisconnect.bind(this, this._sensorTag));
    
    callback(null, sensorTag);
  }.bind(this));
};

IndoorReport.prototype.startCapture = function(sensorTag, callback)
{
  
  async.series([
               function(callback) {
                debug('connectAndSetUp');
                sensorTag.connectAndSetUp(callback);
              },
              function(callback_series) {
                debug('enable humidity and temperature');
                sensorTag.enableHumidity(callback_series);
              },
              function(callback_series) {
                debug('set humidity and temperature period');
                sensorTag.setHumidityPeriod(2000, callback_series);
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
                sensorTag.setBarometricPressurePeriod(10000, callback_series);
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
                sensorTag.setIrTemperaturePeriod(2000, callback_series);
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
                sensorTag.setLuxometerPeriod(2000, callback_series);
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
                debug('set accelerometer range to 2G');
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
                  });
                }
              });
};

IndoorReport.prototype.onHumidityChanged = function(sensorTag, temperature, humidity) {
  debug('\ttemperature = %d °C', temperature.toFixed(1));
  debug('\thumidity = %d %', humidity.toFixed(1));
  this.toDb(sensorTag, "temperature", temperature);
  this.toDb(sensorTag, "humidity", humidity);
};

IndoorReport.prototype.onBarometricPressureChanged = function(sensorTag, pressure) {
  debug('\tpressure = %d mBar', pressure.toFixed(1));
  this.toDb(sensorTag, "pressure", pressure);
};

IndoorReport.prototype.onIrTemperatureChanged = function(sensorTag, objectTemperature, ambientTemperature) {
  debug('\tobject temperature = %d °C', objectTemperature.toFixed(1));
  debug('\tambient temperature = %d °C', ambientTemperature.toFixed(1))
  this.toDb(sensorTag, "ambient_temperature", ambientTemperature);
};

IndoorReport.prototype.onLuxometerChanged = function(sensorTag, lux) {
  debug('\tLUX = %d lux', lux.toFixed(1));
  this.toDb(sensorTag, "lux", lux);
};

IndoorReport.prototype.onAccelerometerChanged = function(sensorTag, x, y, z) {
  debug('\tACCEL  (%d, %d, %d)G', x, y, z);
  this.toDb(sensorTag, "accelX", x);
  this.toDb(sensorTag, "accelY", y);
  this.toDb(sensorTag, "accelZ", z);
};

IndoorReport.prototype.onBatteryLevelChanged = function(sensorTag, level) {
  debug('\tBattery level  %d%', level);
  this.toDb(sensorTag, "battery", level);
};

IndoorReport.prototype.toDb = function(sensorTag, fieldName, fieldValue)
{
  this._dbClient.writePoint(fieldName+ '_TI-ST_' + sensorTag.uuid, {time: new Date(), value: fieldValue}, null, function(err, response) { 
    if(err)
      {
        debug("Cannot write to db : " + err);
      }});
};

IndoorReport.prototype.onDisconnect = function(sensorTag)
{
  debug('sensortag disconnected - try to reconnect!');
  this.startCapture(sensorTag, function()
  {
    debug('capture restarted');
  });
};

debug("starting sensortag indoor report");
  
var indoorReport = new IndoorReport(function(err){
  
  if(err)
  {
    process.exit(2);
  }
  indoorReport.connectSensortag(function(err, sensortag){
    if(err)
    {
      console.log(err + 'when connecting sensortag');
      return;
    }
    
    indoorReport.startCapture(sensortag, function()
    {
      debug("capture started for sensortag with uuid " + sensortag.uuid);
    }.bind(this));
  });
});